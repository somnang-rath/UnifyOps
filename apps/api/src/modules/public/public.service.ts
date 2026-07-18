import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  WikiPage,
  WikiPageDocument,
} from '../wiki/schemas/wiki-page.schema';
import { sanitizePublicHtml } from './sanitize';

/**
 * Anonymous read path for the public Space (ADR 0002 §4).
 *
 * Field-stripping is enforced at the query projection, not by deleting fields
 * after the fact: only public-safe columns are ever loaded. The response must
 * never expose authorId, projectId, publishedBy, parentId, or member data.
 */
@Injectable()
export class PublicService {
  constructor(
    @InjectModel(WikiPage.name)
    private readonly wiki: Model<WikiPageDocument>,
  ) {}

  async getWikiByAnchor(anchor: string) {
    const page = await this.wiki
      .findOne(
        { anchor, isPublic: true },
        { title: 1, content: 1, updatedAt: 1, _id: 0 },
      )
      .lean<{ title: string; content: string; updatedAt: Date }>();
    // Unpublished and non-existent anchors are indistinguishable (both 404):
    // no existence leak.
    if (!page) throw new NotFoundException();

    return {
      type: 'wiki' as const,
      anchor,
      title: page.title,
      // Sanitized here as well as in apps/space: the API must never serve
      // script-bearing HTML to any consumer, and space must not have to trust
      // its upstream (docs/plan/01 §3.4).
      contentHTML: sanitizePublicHtml(page.content),
      updatedAt: page.updatedAt,
    };
  }
}
