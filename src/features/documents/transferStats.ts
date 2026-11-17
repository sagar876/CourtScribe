import { RateMeter } from '../../lib/stats.ts';

/** Real upload/download measurements, read by the Performance Lab. */
class TransferStats {
  activeUploads = 0;
  uploadedBytes = 0;
  private upMeter = new RateMeter(performance.now());
  activeDownloads = 0;
  downloadReceived = 0;
  downloadTotal = 0;
  private downMeter = new RateMeter(performance.now());

  uploadProgress(deltaBytes: number): void {
    this.uploadedBytes += deltaBytes;
    this.upMeter.add(deltaBytes, performance.now());
  }

  downloadProgress(deltaBytes: number): void {
    this.downloadReceived += deltaBytes;
    this.downMeter.add(deltaBytes, performance.now());
  }

  snapshot() {
    const now = performance.now();
    this.upMeter.roll(now);
    this.downMeter.roll(now);
    return {
      activeUploads: this.activeUploads,
      uploadBytesPerSecond: this.upMeter.perSecond,
      uploadedBytes: this.uploadedBytes,
      activeDownloads: this.activeDownloads,
      downloadBytesPerSecond: this.downMeter.perSecond,
      downloadReceived: this.downloadReceived,
      downloadTotal: this.downloadTotal,
    };
  }
}

export const transferStats = new TransferStats();
