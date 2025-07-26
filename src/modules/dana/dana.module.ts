import { Module } from '@nestjs/common';
import { MiddlewareConsumer } from '@nestjs/common';
import { LoggerMiddleware } from '../../middlewares/logger.middleware';
import { ConfigModule } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { DanaService } from './dana.service';
import { DanaController } from './dana.controller';
import { LoggerModule } from '../logger/logger.module';
import { GLOBAL_CONFIG } from '../../configs/global.config';

@Module({
  imports: [
    HttpModule,
    LoggerModule,
    ConfigModule.forRoot({ isGlobal: true, load: [() => GLOBAL_CONFIG] }),
  ],
  providers: [DanaService],
  controllers: [DanaController],
  exports: [DanaService],
})
export class DanaModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LoggerMiddleware).forRoutes('*');
  }
}
