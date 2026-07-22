import { Module } from '@nestjs/common';
import { InstanceModule } from '../instance/instance.module';
import { UnsplashController } from './unsplash.controller';
import { UnsplashService } from './unsplash.service';

/**
 * Unsplash cover-image proxy (ADR 0010). No Mongoose schema of its own —
 * it resolves the toggle + access key through InstanceService and proxies
 * search/download-trigger calls to api.unsplash.com.
 */
@Module({
  imports: [InstanceModule],
  controllers: [UnsplashController],
  providers: [UnsplashService],
  exports: [UnsplashService],
})
export class UnsplashModule {}
