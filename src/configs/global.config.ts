import { API_PREFIX } from '../shared/constants/global.constants';

import { Config } from './config.interface';
import { format, transports } from 'winston';
import 'winston-daily-rotate-file';

export const GLOBAL_CONFIG: Config = {
  nest: {
    port: 3000,
  },
  cors: {
    enabled: true,
  },
  swagger: {
    enabled: true,
    title: 'Nestjs Prisma Starter',
    description: 'The nestjs API description',
    version: '1.5',
    path: API_PREFIX,
  },
  security: {
    accessToken: {
      expiresIn: 3600 * 1, // 1h testing only
      bcryptSaltOrRound: 10,
    },
    refreshToken: {
      expiresIn: 3600 * 24, // 24h testing only
      bcryptSaltOrRound: 10,
    },
  },
  logger: {
    transports: [
      // file on daily rotation (error only)
      new transports.DailyRotateFile({
        // %DATE will be replaced by the current date
        filename: `logs/%DATE%-error.log`,
        level: 'error',
        format: format.combine(format.timestamp(), format.json()),
        datePattern: 'YYYY-MM-DD',
        zippedArchive: false, // don't want to zip our logs
        maxFiles: '30d', // will keep log until they are older than 30 days
      }),
      // same for all levels
      new transports.DailyRotateFile({
        filename: `logs/%DATE%-combined.log`,
        format: format.combine(format.timestamp(), format.json()),
        datePattern: 'YYYY-MM-DD',
        zippedArchive: false,
        maxFiles: '30d',
      }),
      new transports.Console({
        format: format.combine(
          format.cli(),
          format.splat(),
          format.timestamp(),
          format.printf((info) => {
            return `${info.timestamp} ${info.level}: ${info.message}`;
          }),
        ),
      }),
    ],
  },
};
