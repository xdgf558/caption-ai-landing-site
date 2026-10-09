import qrcode from 'qrcode-generator';
import { campaignUrl } from './campaignLinks.js';

export function campaignQr(record) {
  const url=campaignUrl(record),qr=qrcode(0,'M');
  qr.addData(url,'Byte');qr.make();
  // Four-module quiet zone, opaque white background, no logo or decoration.
  return {url,modules:qr.getModuleCount(),image:qr.createDataURL(6,24),svg:qr.createSvgTag(6,24)};
}
