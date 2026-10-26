import { Body, Controller, Get, HttpCode, Ip, Post, Put } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { Public } from './decorators/public.decorator';
import { CurrentUser } from './decorators/current-user.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 5 } }) // max 5 login attempts / minute / IP
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto, @Ip() ip: string) {
    return this.authService.login(dto, ip);
  }

  @Get('me')
  me(@CurrentUser('userId') userId: number) {
    return this.authService.me(userId);
  }

  // The signed-in user's own profile — no permission needed beyond signing in.
  @Get('profile')
  profile(@CurrentUser('userId') userId: number) {
    return this.authService.profile(userId);
  }

  @Put('profile')
  updateProfile(@CurrentUser('userId') userId: number, @Body() dto: UpdateProfileDto) {
    return this.authService.updateProfile(userId, dto);
  }
}
