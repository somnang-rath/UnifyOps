import { Controller, Get } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, ConnectionStates } from 'mongoose';
import { Public } from '../../common/decorators/public.decorator';

@Controller('health')
export class HealthController {
  constructor(@InjectConnection() private db: Connection) {}

  @Public()
  @Get()
  check() {
    const dbState = this.db.readyState === ConnectionStates.connected ? 'up' : 'down';
    const status = dbState === 'up' ? 'ok' : 'degraded';
    return {
      status,
      timestamp: new Date().toISOString(),
      services: {
        database: dbState,
      },
    };
  }
}
