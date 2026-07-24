import { Body, Controller, Get, HttpCode, Post, Query, UsePipes } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  ZodQueryPipe,
  ZodValidationPipe,
} from '../../common/pipes/zod-validation.pipe';
import { UnsplashService } from './unsplash.service';
import {
  SearchUnsplashQuery,
  SearchUnsplashQuerySchema,
  TriggerDownloadDto,
  TriggerDownloadSchema,
} from './dto/unsplash.dto';

/**
 * Server-side Unsplash proxy (ADR 0010 §2). JWT-authenticated via the default
 * global guard — this is a member feature, not public surface. The access key
 * never appears in any response.
 */
@Controller('unsplash')
export class UnsplashController {
  constructor(private readonly unsplash: UnsplashService) {}

  @Throttle({ short: { limit: 30, ttl: 60_000 } })
  @Get('search')
  search(@Query(new ZodQueryPipe(SearchUnsplashQuerySchema)) q: SearchUnsplashQuery) {
    return this.unsplash.search(q);
  }

  /**
   * Compliance ping (ADR 0010 §4): always 200 `{ ok }`, so the frontend can
   * fire-and-forget on photo selection without ever error-toasting.
   */
  @Throttle({ short: { limit: 30, ttl: 60_000 } })
  @HttpCode(200)
  @Post('download')
  @UsePipes(new ZodValidationPipe(TriggerDownloadSchema))
  download(@Body() dto: TriggerDownloadDto) {
    return this.unsplash.triggerDownload(dto.downloadLocation);
  }
}
