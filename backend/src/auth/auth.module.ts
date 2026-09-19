import { Global, Module } from '@nestjs/common';
import { SessionTokenService } from './session-token.service.js';
import { SessionAuthGuard } from './session-auth.guard.js';

@Global()
@Module({
  providers: [SessionTokenService, SessionAuthGuard],
  exports: [SessionTokenService, SessionAuthGuard],
})
export class AuthModule {}
