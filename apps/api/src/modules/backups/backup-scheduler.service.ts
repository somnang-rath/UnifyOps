import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Cron } from '@nestjs/schedule';
import {
  BackupSchedule,
  BackupScheduleDocument,
  BackupFrequency,
} from './schemas/backup-schedule.schema';
import { BackupExportService } from './backup-export.service';
import { BackupStorageService } from './backup-storage.service';
import type { UpsertScheduleDto } from './dto/backup.dto';

@Injectable()
export class BackupSchedulerService {
  private readonly log = new Logger(BackupSchedulerService.name);

  constructor(
    @InjectModel(BackupSchedule.name) private scheduleModel: Model<BackupScheduleDocument>,
    private exportSvc: BackupExportService,
    private storageSvc: BackupStorageService,
  ) {}

  // ── CRUD ──────────────────────────────────────────────────────────────────

  async upsert(userId: string, dto: UpsertScheduleDto): Promise<BackupScheduleDocument> {
    const nextRunAt = dto.enabled
      ? this.calcNextRunAt(dto.frequency, dto.time, dto.dayOfWeek, dto.dayOfMonth, dto.timezone)
      : undefined;

    const doc = await this.scheduleModel.findOneAndUpdate(
      { userId: new Types.ObjectId(userId) },
      {
        $set: {
          ...dto,
          userId: new Types.ObjectId(userId),
          ...(nextRunAt ? { nextRunAt } : {}),
        },
      },
      { upsert: true, new: true },
    );
    return doc!;
  }

  async get(userId: string): Promise<BackupScheduleDocument | null> {
    return this.scheduleModel.findOne({ userId: new Types.ObjectId(userId) }).lean() as
      Promise<BackupScheduleDocument | null>;
  }

  async remove(userId: string): Promise<void> {
    await this.scheduleModel.deleteOne({ userId: new Types.ObjectId(userId) });
  }

  // ── Cron — fires every 15 minutes ────────────────────────────────────────

  @Cron('0 */15 * * * *')
  async runDueBackups(): Promise<void> {
    const due = await this.scheduleModel
      .find({ enabled: true, nextRunAt: { $lte: new Date() } })
      .lean();

    for (const schedule of due) {
      const userId = String(schedule.userId);
      try {
        const email  = await this.exportSvc.getEmailById(userId);
        const buffer = await this.exportSvc.exportForUser(
          userId,
          schedule.scopes,
          email,
          schedule.fileName,
        );

        const dateStr   = new Date().toISOString().slice(0, 10);
        const fileName  = `${schedule.fileName} ${dateStr}.prismback`;

        await this.storageSvc.store({
          userId,
          fileName,
          scopes:      schedule.scopes,
          triggeredBy: 'schedule',
          encrypted:   false,
          buffer,
        });

        const nextRunAt = this.calcNextRunAt(
          schedule.frequency,
          schedule.time,
          schedule.dayOfWeek,
          schedule.dayOfMonth,
          schedule.timezone,
        );

        await this.scheduleModel.updateOne(
          { _id: schedule._id },
          { lastRunAt: new Date(), nextRunAt },
        );

        this.log.log(`Auto-backup completed for user ${userId}`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.log.error(`Auto-backup failed for user ${userId}: ${msg}`);
      }
    }
  }

  // ── nextRunAt calculation ─────────────────────────────────────────────────

  calcNextRunAt(
    frequency: BackupFrequency,
    time: string,       // "HH:MM"
    dayOfWeek: number,  // 0-6  (Sun=0)
    dayOfMonth: number, // 1-31
    timezone: string,
  ): Date {
    const [hh, mm] = time.split(':').map(Number);
    const nowUtc = new Date();

    // ── Read current wall-clock date/time in the user's timezone ─────────────

    const dateFmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year:   'numeric',
      month:  '2-digit',
      day:    '2-digit',
      hour:   '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const tzStr    = dateFmt.format(nowUtc);            // "YYYY-MM-DD, HH:MM"
    const [datePart, timePart] = tzStr.split(', ');
    const [tzYear, tzMonth1, tzDay] = datePart.split('-').map(Number);
    const [tzHour, tzMin]           = timePart.split(':').map(Number);
    const tzNowMin = tzHour * 60 + tzMin;
    const wantMin  = hh * 60 + mm;

    const DOW_MAP: Record<string, number> = {
      Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
    };
    const dowFmt = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone, weekday: 'short',
    });
    const tzDow = DOW_MAP[dowFmt.format(nowUtc)] ?? 0;

    const [y, mo0, d] = [tzYear, tzMonth1 - 1, tzDay];

    // ── Helper: convert a TZ wall-clock datetime back to a UTC Date ──────────
    // Strategy: treat the wall-clock date as UTC, then correct for the TZ
    // offset observed at that approximate timestamp.  One Intl round-trip is
    // sufficient for all practical timezone offsets; DST edge cases are within
    // ±1 h and the cron fires every 15 min anyway.
    const wallToUtc = (wy: number, wmo0: number, wd: number, wh: number, wm: number): Date => {
      const approx = new Date(Date.UTC(wy, wmo0, wd, wh, wm, 0));
      const p = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false,
      }).formatToParts(approx);
      const ph = Number(p.find((x) => x.type === 'hour')!.value) % 24;
      const pm = Number(p.find((x) => x.type === 'minute')!.value);
      return new Date(approx.getTime() + (wh * 60 + wm - ph * 60 - pm) * 60_000);
    };

    // ── Helper: advance N calendar days without JS Date overflow risk ────────
    const addDays = (ey: number, emo0: number, ed: number, n: number) => {
      const dt = new Date(Date.UTC(ey, emo0, ed + n));
      return [dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()] as const;
    };

    // ── Compute next occurrence ───────────────────────────────────────────────

    if (frequency === 'daily') {
      if (wantMin > tzNowMin) return wallToUtc(y, mo0, d, hh, mm);
      const [ny, nmo, nd] = addDays(y, mo0, d, 1);
      return wallToUtc(ny, nmo, nd, hh, mm);
    }

    if (frequency === 'weekly') {
      const diff = (dayOfWeek - tzDow + 7) % 7;
      if (diff === 0 && wantMin > tzNowMin) return wallToUtc(y, mo0, d, hh, mm);
      const [ny, nmo, nd] = addDays(y, mo0, d, diff === 0 ? 7 : diff);
      return wallToUtc(ny, nmo, nd, hh, mm);
    }

    // monthly — use Date.UTC + explicit month arithmetic to avoid JS overflow
    const targetDay = Math.min(dayOfMonth, this.daysInMonth(y, mo0));
    if (d < targetDay || (d === targetDay && wantMin > tzNowMin)) {
      return wallToUtc(y, mo0, targetDay, hh, mm);
    }
    // Advance to the 1st of next month (safe regardless of current day)
    const next = new Date(Date.UTC(y, mo0 + 1, 1));
    const ny = next.getUTCFullYear();
    const nmo = next.getUTCMonth();
    return wallToUtc(ny, nmo, Math.min(dayOfMonth, this.daysInMonth(ny, nmo)), hh, mm);
  }

  private daysInMonth(year: number, month: number): number {
    return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  }
}
