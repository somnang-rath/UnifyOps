import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Workbook, WorkbookDocument } from './schemas/workbook.schema';
import {
  CreateWorkbookDto,
  ShareWorkbookDto,
  UpdateWorkbookDto,
} from './dto/workbook.dto';
import { UsersService } from '../users/users.service';
import { workbookToXlsxBuffer } from './xlsx.export';

export type WorkbookAccess = 'owner' | 'edit' | 'read' | null;

@Injectable()
export class WorkbooksService {
  constructor(
    @InjectModel(Workbook.name)
    private model: Model<WorkbookDocument>,
    private users: UsersService,
  ) {}

  /**
   * Resolves the viewer's effective access on a workbook. Owner short-circuits.
   * Otherwise scan grants for matches by user id OR role; take the highest level
   * among matching grants (edit > read).
   */
  private resolveAccess(
    viewer: { id: string; role: string },
    wb: any,
  ): WorkbookAccess {
    if (!wb) return null;
    if (String(wb.ownerId) === viewer.id) return 'owner';
    const matching = (wb.grants ?? []).filter(
      (g: any) =>
        (g.userId && String(g.userId) === viewer.id) ||
        (g.role && g.role === viewer.role),
    );
    if (matching.length === 0) return null;
    return matching.some((g: any) => g.level === 'edit') ? 'edit' : 'read';
  }

  async list(
    viewer: { id: string; role: string },
  ): Promise<Record<string, any>[]> {
    const vOid = new Types.ObjectId(viewer.id);
    const own = await this.model
      .find({ ownerId: vOid })
      .select(
        'name activeSheetId createdAt updatedAt sheets.id sheets.name grants ownerId',
      )
      .sort({ updatedAt: -1 })
      .lean();
    const shared = await this.model
      .find({
        ownerId: { $ne: vOid },
        $or: [{ 'grants.userId': vOid }, { 'grants.role': viewer.role }],
      })
      .select(
        'name activeSheetId createdAt updatedAt sheets.id sheets.name grants ownerId',
      )
      .sort({ updatedAt: -1 })
      .lean();

    const annotate = (wb: any) => {
      const access = this.resolveAccess(viewer, wb);
      const { grants: _g, ...rest } = wb;
      return { ...rest, _access: access, _isShared: access !== 'owner' };
    };
    return [...own.map(annotate), ...shared.map(annotate)];
  }

  async byId(
    viewer: { id: string; role: string },
    id: string,
  ): Promise<Record<string, any>> {
    const wb = await this.model.findById(id).lean();
    if (!wb) throw new NotFoundException();
    const access = this.resolveAccess(viewer, wb);
    if (!access) throw new ForbiddenException();
    const { grants: _g, ...rest } = wb as any;
    return { ...rest, _access: access, _isShared: access !== 'owner' };
  }

  create(viewerId: string, dto: CreateWorkbookDto) {
    const firstSheetId = `sh_${Math.random().toString(36).slice(2, 8)}`;
    return this.model.create({
      ownerId: new Types.ObjectId(viewerId),
      name: dto.name,
      activeSheetId: firstSheetId,
      sheets: [
        {
          id: firstSheetId,
          name: 'Sheet1',
          rowCount: 100,
          colCount: 26,
          cells: {},
          colWidths: {},
          rowHeights: {},
        },
      ],
      grants: [],
    });
  }

  async update(
    viewer: { id: string; role: string },
    id: string,
    dto: UpdateWorkbookDto,
  ) {
    const wb = await this.model.findById(id);
    if (!wb) throw new NotFoundException();
    const access = this.resolveAccess(viewer, wb);
    if (access !== 'owner' && access !== 'edit')
      throw new ForbiddenException();

    if (dto.name !== undefined && dto.name !== wb.name) {
      if (access !== 'owner')
        throw new ForbiddenException('Only the owner can rename');
      wb.name = dto.name;
    }
    if (dto.activeSheetId !== undefined) wb.activeSheetId = dto.activeSheetId;
    if (dto.sheets !== undefined) wb.sheets = dto.sheets as any;
    if (dto.namedRanges !== undefined)
      wb.namedRanges = dto.namedRanges as any;
    wb.version = (wb.version ?? 0) + 1;
    return wb.save();
  }

  async remove(viewerId: string, id: string) {
    const wb = await this.model.findById(id);
    if (!wb) throw new NotFoundException();
    if (String(wb.ownerId) !== viewerId) throw new ForbiddenException();
    await wb.deleteOne();
    return { ok: true };
  }

  async exportXlsx(
    viewer: { id: string; role: string },
    id: string,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const wb = await this.byId(viewer, id);
    const buffer = await workbookToXlsxBuffer({
      name: wb.name,
      sheets: wb.sheets,
    });
    const safe = String(wb.name || 'workbook').replace(/[^\w\-]+/g, '_');
    return { buffer, filename: `${safe}.xlsx` };
  }

  async copy(viewer: { id: string; role: string }, id: string) {
    const src = await this.model.findById(id).lean();
    if (!src) throw new NotFoundException();
    const access = this.resolveAccess(viewer, src);
    if (!access) throw new ForbiddenException();

    // Deep clone via JSON roundtrip so embedded sub-doc _ids aren't reused.
    const clone = JSON.parse(JSON.stringify(src.sheets ?? []));
    const created = await this.model.create({
      ownerId: new Types.ObjectId(viewer.id),
      name: `Copy of ${src.name}`,
      activeSheetId: src.activeSheetId,
      sheets: clone,
      grants: [],
      namedRanges: JSON.parse(JSON.stringify(src.namedRanges ?? [])),
      version: 0,
    });
    const out = created.toObject() as Record<string, any>;
    delete out.grants;
    return { ...out, _access: 'owner', _isShared: false };
  }

  // ---------- Grants (sharing) ----------

  async listGrants(viewerId: string, id: string) {
    const wb = await this.model.findById(id).lean();
    if (!wb) throw new NotFoundException();
    if (String(wb.ownerId) !== viewerId) throw new ForbiddenException();
    const grants = wb.grants ?? [];
    if (grants.length === 0) return [];
    const users = await this.users.list();
    const byId = new Map(users.map((u) => [String(u._id), u]));
    return grants.map((g) =>
      g.userId
        ? {
            userId: String(g.userId),
            role: null,
            level: g.level,
            user: byId.get(String(g.userId)) ?? null,
          }
        : {
            userId: null,
            role: g.role ?? null,
            level: g.level,
            user: null,
          },
    );
  }

  async setGrant(viewerId: string, id: string, dto: ShareWorkbookDto) {
    const wb = await this.model.findById(id);
    if (!wb) throw new NotFoundException();
    if (String(wb.ownerId) !== viewerId) throw new ForbiddenException();
    if (dto.userId && dto.userId === viewerId)
      throw new ForbiddenException('Cannot share workbook with yourself');

    const idx = wb.grants.findIndex((g) =>
      dto.userId
        ? g.userId && String(g.userId) === dto.userId
        : g.role === dto.role,
    );
    if (idx >= 0) {
      wb.grants[idx].level = dto.level;
    } else if (dto.userId) {
      wb.grants.push({
        userId: new Types.ObjectId(dto.userId),
        level: dto.level,
      } as any);
    } else {
      wb.grants.push({
        role: dto.role,
        level: dto.level,
      } as any);
    }
    await wb.save();
    return this.listGrants(viewerId, id);
  }

  /**
   * Removes a grant. `target` is a user ObjectId (24-hex) or a role string.
   */
  async removeGrant(viewerId: string, id: string, target: string) {
    const wb = await this.model.findById(id);
    if (!wb) throw new NotFoundException();
    if (String(wb.ownerId) !== viewerId) throw new ForbiddenException();
    const isOid = /^[0-9a-fA-F]{24}$/.test(target);
    wb.grants = wb.grants.filter((g) =>
      isOid ? !(g.userId && String(g.userId) === target) : g.role !== target,
    ) as any;
    await wb.save();
    return this.listGrants(viewerId, id);
  }

  async fetchGoogleSheetCsv(url: string): Promise<{ csv: string }> {
    const idMatch = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    if (!idMatch) {
      throw new BadRequestException('Invalid Google Sheets URL.');
    }
    const spreadsheetId = idMatch[1];
    const gidMatch = url.match(/[#?&]gid=(\d+)/);
    const gid = gidMatch?.[1];
    const gidParam = gid ? `&gid=${gid}` : '';

    // Try several export endpoints in order; Google's behaviour varies by
    // sharing mode and whether the sheet has been published to the web.
    const candidates = [
      // gviz endpoint — works for "Anyone with the link can view" without auth
      `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv${gidParam}`,
      // Standard export — works for "Publish to web" sheets
      `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv${gidParam}`,
      // pub endpoint — also works for "Publish to web"
      `https://docs.google.com/spreadsheets/d/${spreadsheetId}/pub?output=csv${gidParam}`,
    ];

    const headers = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      Accept: 'text/csv,text/plain,*/*',
    };

    const FETCH_TIMEOUT_MS = 15_000;

    for (const exportUrl of candidates) {
      let response: Response;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        try {
          response = await fetch(exportUrl, {
            headers,
            redirect: 'follow',
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timer);
        }
      } catch {
        continue;
      }
      if (!response.ok) continue;

      const contentType = response.headers.get('content-type') ?? '';
      const text = await response.text();

      // Skip if Google redirected us to an HTML login / consent page.
      const looksLikeHtml =
        contentType.includes('text/html') ||
        text.trimStart().startsWith('<!') ||
        text.trimStart().toLowerCase().startsWith('<html');
      if (looksLikeHtml) continue;

      return { csv: text };
    }

    throw new BadRequestException(
      'Could not download the sheet. ' +
        'Either the sheet is private, or it needs to be published to the web. ' +
        'In Google Sheets: File → Share → Publish to web → publish as CSV, then paste that URL. ' +
        'Alternatively, download the CSV manually: File → Download → CSV.',
    );
  }
}
