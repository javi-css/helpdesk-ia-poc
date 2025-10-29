import { Module } from '@nestjs/common';
import { AskService } from './ask.service';
import { AskController } from './ask.controller';
import { HttpModule } from '@nestjs/axios';
@Module({
  imports: [HttpModule],
  controllers: [AskController],
  providers: [AskService],
})
export class AskModule {}
