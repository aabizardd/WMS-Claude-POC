import { Global, Module } from '@nestjs/common';
import { ErpHttpService } from './erp-http.service';

// Global so every sync service can inject the shared ERP client without each
// feature module importing this one.
@Global()
@Module({
  providers: [ErpHttpService],
  exports: [ErpHttpService],
})
export class ErpModule {}
