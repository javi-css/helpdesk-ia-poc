import { Controller, Post, Body } from '@nestjs/common';
import { AskService } from './ask.service';
import { CreateAskDto } from './dto/create-ask.dto';

@Controller('ask')
export class AskController {
  constructor(private readonly askService: AskService) {}

  @Post()
  create(@Body() createAskDto: CreateAskDto) {
    return this.askService.processNewTicket(createAskDto.question);
  }
}
