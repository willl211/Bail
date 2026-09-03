import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AccountService } from './account.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SessionGuard } from './session.guard';

/**
 * Authentification par session serveur + cookie `httpOnly` (docs/tech-stack.md).
 *
 * Le guard est enregistré via `APP_GUARD`, donc appliqué à **toutes** les
 * routes : une route est privée par défaut et doit être marquée `@Public()`
 * pour ne pas l'être. Un oubli rend alors la route inaccessible — visible
 * immédiatement — plutôt que de l'exposer sans contrôle.
 *
 * Le module est `@Global()` pour que les autres modules puissent injecter
 * `AuthService` sans le réimporter partout.
 */
@Global()
@Module({
  controllers: [AuthController],
  providers: [AuthService, AccountService, { provide: APP_GUARD, useClass: SessionGuard }],
  exports: [AuthService, AccountService],
})
export class AuthModule {}
