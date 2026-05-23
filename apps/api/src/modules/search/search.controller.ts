import { Controller, Get, Query } from '@nestjs/common';
import { SearchService } from './search.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('search')
export class SearchController {
  constructor(private search: SearchService) {}

  @Get()
  query(
    @CurrentUser() user: { id: string },
    @Query('q') q: string,
    @Query('limit') limit?: string,
  ) {
    const safeQ = (q ?? '').trim();
    const safeLimit = Math.min(parseInt(limit ?? '20', 10) || 20, 50);
    return this.search.query(user.id, safeQ, safeLimit);
  }
}
