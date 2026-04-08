import { TimeBucketService } from './time-bucket.service';

describe('TimeBucketService', () => {
  it('builds monthly period keys', () => {
    const service = new TimeBucketService({} as any);
    const date = new Date('2026-02-09T00:00:00Z');
    expect(service.buildPeriodKey(date, 'MONTHLY')).toBe('2026-02');
  });

  it('throws when bucket missing', async () => {
    const prisma = {
      timeBucket: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    } as any;
    const service = new TimeBucketService(prisma);

    await expect(
      service.getBucketOrThrow('tenant-1', new Date('2026-02-01'), 'MONTHLY'),
    ).rejects.toThrow('No time bucket');
  });

  it('throws when bucket frozen and allowFrozen is false (default)', async () => {
    const prisma = {
      timeBucket: {
        findFirst: jest.fn().mockResolvedValue({ isFrozen: true }),
      },
    } as any;
    const service = new TimeBucketService(prisma);

    await expect(
      service.getBucketOrThrow('tenant-1', new Date('2026-02-01'), 'MONTHLY'),
    ).rejects.toThrow('frozen');
  });

  it('allows frozen bucket when allowFrozen option is true', async () => {
    const bucket = { id: 'bucket-1', isFrozen: true };
    const prisma = {
      timeBucket: {
        findFirst: jest.fn().mockResolvedValue(bucket),
      },
    } as any;
    const service = new TimeBucketService(prisma);

    await expect(
      service.getBucketOrThrow('tenant-1', new Date('2026-02-01'), 'MONTHLY', { allowFrozen: true }),
    ).resolves.toEqual(bucket);
  });

  it('returns bucket when valid and not frozen', async () => {
    const bucket = { id: 'bucket-1', isFrozen: false };
    const prisma = {
      timeBucket: {
        findFirst: jest.fn().mockResolvedValue(bucket),
      },
    } as any;
    const service = new TimeBucketService(prisma);

    await expect(
      service.getBucketOrThrow('tenant-1', new Date('2026-02-01'), 'MONTHLY'),
    ).resolves.toEqual(bucket);
  });
});
