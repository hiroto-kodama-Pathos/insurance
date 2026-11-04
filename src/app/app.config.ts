import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, TitleStrategy } from '@angular/router';
import { AppTitleStrategy } from './core/ui/app-title-strategy';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    { provide: TitleStrategy, useClass: AppTitleStrategy },
  ]
};
