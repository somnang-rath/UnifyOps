import { Controller, Get, Query } from '@nestjs/common';
import { SearchService } from './search.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('search')
export class SearchController {
  constructor(private search: SearchService) {}

  /**
   * `workspaceId` is optional and narrowing-only (ADR 0011 §2b) — omitting it
   * searches every workspace the caller belongs to, it never widens the scope.
   */
  @Get()
  query(
    @CurrentUser() user: { id: string },
    @Query('q') q: string,
    @Query('limit') limit?: string,
    @Query('workspaceId') workspaceId?: string,
  ) {
    const safeQ = (q ?? '').trim();
    const safeLimit = Math.min(parseInt(limit ?? '20', 10) || 20, 50);
    return this.search.query(user.id, safeQ, safeLimit, workspaceId?.trim());
  }
}
