import { BadRequestException } from '@nestjs/common';
import { PostingTransactionType } from '@prisma/client';
import { AccountingService } from './accounting.service';

function createMockPrisma() {
  return {
    gLAccount: {
      findFirst: jest.fn(),
    },
    productCategory: {
      findFirst: jest.fn(),
    },
    postingProfile: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
  } as any;
}

describe('AccountingService posting profile normalization', () => {
  it('stores canonical product category fields when creating posting profiles', async () => {
    const prisma = createMockPrisma();
    prisma.gLAccount.findFirst
      .mockResolvedValueOnce({ id: 'debit-1' })
      .mockResolvedValueOnce({ id: 'credit-1' });
    prisma.productCategory.findFirst.mockResolvedValue({
      id: 'category-1',
      name: 'Finished Good',
      code: 'FINISHED_GOOD',
    });
    prisma.postingProfile.create.mockResolvedValue({ id: 'profile-1' });

    const service = new AccountingService(prisma, {} as any);

    await service.createPostingProfile('tenant-1', {
      profileName: 'Receipt FG',
      transactionType: PostingTransactionType.PRODUCTION_RECEIPT,
      debitAccountId: 'debit-1',
      creditAccountId: 'credit-1',
      productCategoryId: 'category-1',
    });

    expect(prisma.postingProfile.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          productCategoryId: 'category-1',
          productCategory: 'Finished Good',
        }),
      }),
    );
  });

  it('rejects unknown product category references for posting profiles', async () => {
    const prisma = createMockPrisma();
    prisma.gLAccount.findFirst
      .mockResolvedValueOnce({ id: 'debit-1' })
      .mockResolvedValueOnce({ id: 'credit-1' });
    prisma.productCategory.findFirst.mockResolvedValue(null);

    const service = new AccountingService(prisma, {} as any);

    await expect(
      service.createPostingProfile('tenant-1', {
        profileName: 'Receipt FG',
        transactionType: PostingTransactionType.PRODUCTION_RECEIPT,
        debitAccountId: 'debit-1',
        creditAccountId: 'credit-1',
        productCategoryId: 'missing-category',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('matches relation-backed posting profiles when resolving with legacy category strings', async () => {
    const prisma = createMockPrisma();
    prisma.productCategory.findFirst.mockResolvedValue({
      id: 'category-1',
      name: 'Finished Good',
      code: 'FINISHED_GOOD',
    });
    prisma.postingProfile.findMany.mockResolvedValue([
      {
        id: 'general-profile',
        transactionType: PostingTransactionType.PRODUCTION_RECEIPT,
        productCategoryId: null,
        productCategory: null,
        locationId: null,
        priority: 0,
      },
      {
        id: 'specific-profile',
        transactionType: PostingTransactionType.PRODUCTION_RECEIPT,
        productCategoryId: 'category-1',
        productCategory: 'Finished Good',
        locationId: null,
        priority: 10,
      },
    ]);

    const service = new AccountingService(prisma, {} as any);

    const result = await service.resolvePostingProfile(
      'tenant-1',
      PostingTransactionType.PRODUCTION_RECEIPT,
      'finished_good',
    );

    expect(result).toEqual(expect.objectContaining({ id: 'specific-profile' }));
  });
});