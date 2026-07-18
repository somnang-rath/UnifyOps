import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as crypto from 'crypto';
import { Webhook, WebhookDocument } from './schemas/webhook.schema';
import {
  WebhookDelivery,
  WebhookDeliveryDocument,
} from './schemas/webhook-delivery.schema';
import { ProjectAccessService } from '../projects/access/project-access.service';
import type { CreateWebhookDto, UpdateWebhookDto } from './dto/webhook.dto';

const oid = (v: string) => new Types.ObjectId(v);

/** Deactivate a webhook after this many straight failures — a dead endpoint. */
const FAILURE_THRESHOLD = 15;
const DELIVERY_TIMEOUT_MS = 5000;

@Injectable()
export class WebhooksService {
  constructor(
    @InjectModel(Webhook.name) private model: Model<WebhookDocument>,
    @InjectModel(WebhookDelivery.name)
    private deliveryModel: Model<WebhookDeliveryDocument>,
    private access: ProjectAccessService,
  ) {}

  async create(userId: string, dto: CreateWebhookDto) {
    await this.access.assertWorkspaceMember(userId, dto.workspaceId);
    const secret = 'whsec_' + crypto.randomBytes(24).toString('hex');
    const doc = await this.model.create({
      workspaceId: oid(dto.workspaceId),
      createdBy: oid(userId),
      url: dto.url,
      events: dto.events,
      secret,
    });
    // The secret is shown once so the receiver can be configured to verify it.
    return { ...this.shape(doc), secret };
  }

  async list(userId: string, workspaceId: string) {
    await this.access.assertWorkspaceMember(userId, workspaceId);
    const rows = await this.model
      .find({ workspaceId: oid(workspaceId) })
      .sort({ createdAt: -1 })
      .lean();
    return rows.map((r) => this.shape(r));
  }

  async update(userId: string, id: string, dto: UpdateWebhookDto) {
    const hook = await this.owned(userId, id);
    if (dto.url !== undefined) hook.url = dto.url;
    if (dto.events !== undefined) hook.events = dto.events;
    if (dto.active !== undefined) {
      hook.active = dto.active;
      // Re-enabling clears the failure count so it gets a fresh chance.
      if (dto.active) hook.consecutiveFailures = 0;
    }
    await hook.save();
    return this.shape(hook);
  }

  async remove(userId: string, id: string) {
    const hook = await this.owned(userId, id);
    await hook.deleteOne();
    return { ok: true };
  }

  async deliveries(userId: string, id: string) {
    await this.owned(userId, id);
    const rows = await this.deliveryModel
      .find({ webhookId: oid(id) })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    return rows.map((r) => ({
      id: String(r._id),
      event: r.event,
      status: r.status,
      success: r.success,
      error: r.error,
      attempts: r.attempts,
      createdAt: r.createdAt,
    }));
  }

  /**
   * Fan an event out to every active subscriber in a workspace. Fire-and-forget
   * from the caller's view: a slow or failing receiver must never slow down the
   * request that produced the event.
   */
  async dispatch(
    workspaceId: string | Types.ObjectId,
    event: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const hooks = await this.model.find({
      workspaceId:
        typeof workspaceId === 'string' ? oid(workspaceId) : workspaceId,
      active: true,
      $or: [{ events: '*' }, { events: event }],
    });
    await Promise.all(hooks.map((h) => this.deliver(h, event, payload)));
  }

  private async deliver(
    hook: WebhookDocument,
    event: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const body = JSON.stringify({
      event,
      workspaceId: String(hook.workspaceId),
      deliveredAt: new Date().toISOString(),
      data: payload,
    });
    const signature = crypto
      .createHmac('sha256', hook.secret)
      .update(body)
      .digest('hex');

    let status: number | null = null;
    let success = false;
    let error: string | null = null;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
      const res = await fetch(hook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Prism-Event': event,
          // Receivers verify: HMAC-SHA256(body, secret).
          'X-Prism-Signature': `sha256=${signature}`,
        },
        body,
        signal: controller.signal,
      }).finally(() => clearTimeout(timer));
      status = res.status;
      success = res.ok;
    } catch (err) {
      error = err instanceof Error ? err.message : 'delivery failed';
    }

    await this.deliveryModel.create({
      webhookId: hook._id,
      event,
      payload,
      status,
      success,
      error,
      attempts: 1,
    });

    // Update rolling health; auto-disable a persistently dead endpoint.
    hook.lastDeliveryAt = new Date();
    hook.lastStatus = status;
    hook.consecutiveFailures = success ? 0 : hook.consecutiveFailures + 1;
    if (hook.consecutiveFailures >= FAILURE_THRESHOLD) hook.active = false;
    await hook.save();
  }

  private async owned(userId: string, id: string): Promise<WebhookDocument> {
    const hook = await this.model.findById(id);
    if (!hook) throw new NotFoundException('Webhook not found');
    // Workspace membership, not just the creator — a webhook belongs to the
    // workspace, and any member may manage it.
    await this.access.assertWorkspaceMember(userId, hook.workspaceId);
    return hook;
  }

  /** Public shape — never includes the signing secret. */
  private shape(h: Webhook & { _id?: unknown }) {
    return {
      id: String((h as { _id: unknown })._id),
      workspaceId: String(h.workspaceId),
      url: h.url,
      events: h.events,
      active: h.active,
      lastDeliveryAt: h.lastDeliveryAt,
      lastStatus: h.lastStatus,
      consecutiveFailures: h.consecutiveFailures,
    };
  }
}
