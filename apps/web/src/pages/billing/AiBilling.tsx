import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDownTrayIcon,
  BanknotesIcon,
  CreditCardIcon,
  ExclamationTriangleIcon,
  ReceiptRefundIcon,
  ScaleIcon,
  SparklesIcon,
  WalletIcon,
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import { Button, Card, EmptyState, Modal } from '../../components/ui';
import {
  aiBillingService,
  type AiDisputeType,
  type AiLedgerType,
} from '../../services/api/ai-billing.service';

const LEDGER_LABELS: Record<AiLedgerType, string> = {
  PURCHASE: 'Credit Purchase',
  MANUAL_CREDIT: 'Manual Credit',
  USAGE_CHARGE: 'AI Usage',
  REFUND: 'Refund',
  BONUS_CREDIT: 'Bonus Credit',
  PROMO_CREDIT: 'Promo Credit',
  DISPUTE_RESOLUTION: 'Dispute Resolution',
  CHARGE_REVERSAL: 'Charge Reversal',
  CREDIT_EXPIRY: 'Credit Expiry',
  ADMIN_ADJUSTMENT: 'Adjustment',
  CORRECTION: 'Correction',
};

const DISPUTE_TYPES: Array<{ value: AiDisputeType; label: string }> = [
  { value: 'UNEXPECTED_CHARGE', label: 'Unexpected charge' },
  { value: 'DUPLICATE_CHARGE', label: 'Duplicate charge' },
  { value: 'FAILED_REQUEST', label: 'Charged for a failed request' },
  { value: 'INCORRECT_BILLING', label: 'Incorrect billing' },
  { value: 'REFUND_REQUEST', label: 'Refund request' },
  { value: 'TOKEN_USAGE_DISAGREEMENT', label: 'Token usage disagreement' },
];

type TabKey = 'transactions' | 'usage' | 'purchases' | 'disputes';

function apiErrorMessage(error: unknown): string | undefined {
  return (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
}

function money(value: string | number, currency = 'USD'): string {
  const number = Number(value);
  return `${currency === 'USD' ? '$' : `${currency} `}${number.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function exportCsv(filename: string, headers: string[], rows: Array<Array<string | number | null>>) {
  const escape = (value: unknown) => {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const csv = [headers.join(','), ...rows.map((row) => row.map(escape).join(','))].join('\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

/**
 * Customer AI billing dashboard: prepaid credit wallet, purchases (Stripe
 * checkout or bank transfer proof), full ledger, token-level usage history,
 * and billing disputes. Providers/models/pricing are platform-managed and
 * intentionally absent here.
 */
export default function AiBilling() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<TabKey>('transactions');
  const [buyOpen, setBuyOpen] = useState(false);
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [activeDisputeId, setActiveDisputeId] = useState<string | null>(null);

  const wallet = useQuery({ queryKey: ['ai-billing', 'wallet'], queryFn: () => aiBillingService.getWallet() });
  const summary = useQuery({ queryKey: ['ai-billing', 'summary'], queryFn: () => aiBillingService.getSummary() });
  const transactions = useQuery({ queryKey: ['ai-billing', 'transactions'], queryFn: () => aiBillingService.listTransactions(1, 100) });
  const usage = useQuery({ queryKey: ['ai-billing', 'usage'], queryFn: () => aiBillingService.listUsage(1, 100), enabled: tab === 'usage' });
  const purchases = useQuery({ queryKey: ['ai-billing', 'purchases'], queryFn: () => aiBillingService.listPurchases(1, 100), enabled: tab === 'purchases' || buyOpen });
  const disputes = useQuery({ queryKey: ['ai-billing', 'disputes'], queryFn: () => aiBillingService.listDisputes(1, 50), enabled: tab === 'disputes' });

  const currency = wallet.data?.currency ?? 'USD';
  const refreshAll = () => queryClient.invalidateQueries({ queryKey: ['ai-billing'] });

  const cards = useMemo(() => ([
    { label: 'Available Balance', value: wallet.data ? money(wallet.data.availableBalance, currency) : '—', icon: WalletIcon, accent: wallet.data?.balanceState },
    { label: 'Reserved', value: wallet.data ? money(wallet.data.reservedBalance, currency) : '—', icon: ScaleIcon },
    { label: 'Spent This Month', value: summary.data ? money(summary.data.monthToDate.spend, currency) : '—', icon: SparklesIcon },
    { label: 'Lifetime Purchased', value: wallet.data ? money(wallet.data.totalPurchased, currency) : '—', icon: BanknotesIcon },
    ...(summary.data?.budget?.maxMonthlySpend
      ? [{
          label: 'Remaining Monthly Budget',
          value: money(summary.data.budget.remainingMonthlyBudget ?? 0, currency),
          icon: ScaleIcon,
          accent: Number(summary.data.budget.remainingMonthlyBudget) <= 0 ? ('critical' as const) : undefined,
        }]
      : []),
  ]), [wallet.data, summary.data, currency]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-secondary-900 dark:text-white lg:text-2xl">AI Billing</h1>
          <p className="mt-0.5 text-sm text-secondary-500 dark:text-secondary-400">
            Prepaid AI credits, usage history, and billing support
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" leftIcon={<ExclamationTriangleIcon className="h-4 w-4" />} onClick={() => setDisputeOpen(true)}>
            Raise Dispute
          </Button>
          <Button size="sm" leftIcon={<CreditCardIcon className="h-4 w-4" />} onClick={() => setBuyOpen(true)}>
            Buy Credits
          </Button>
        </div>
      </div>

      {wallet.data?.status === 'SUSPENDED' && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300">
          Your AI wallet is suspended — purchase credits to resume AI features.
        </div>
      )}
      {wallet.data?.balanceState === 'low' && wallet.data.status === 'ACTIVE' && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
          Balance is running low — consider topping up to avoid interruption.
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <Card key={card.label} padding="sm">
            <div className="flex items-center gap-3 p-2">
              <div className={`rounded-lg p-2 ${card.accent === 'critical' ? 'bg-red-100 text-red-600 dark:bg-red-900/40' : card.accent === 'low' ? 'bg-amber-100 text-amber-600 dark:bg-amber-900/40' : 'bg-primary-50 text-primary-600 dark:bg-primary-900/40'}`}>
                <card.icon className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-xs text-secondary-500 dark:text-secondary-400">{card.label}</p>
                <p className="text-lg font-bold text-secondary-900 dark:text-white">{card.value}</p>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Card padding="sm">
        <div className="flex flex-wrap items-center gap-1 border-b border-secondary-100 px-2 pb-2 dark:border-secondary-800">
          {([['transactions', 'Transactions'], ['usage', 'AI Usage'], ['purchases', 'Purchases'], ['disputes', 'Disputes']] as Array<[TabKey, string]>).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium ${tab === key ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300' : 'text-secondary-600 hover:bg-secondary-50 dark:text-secondary-400 dark:hover:bg-secondary-800'}`}
            >
              {label}
            </button>
          ))}
          <div className="ml-auto">
            {tab === 'transactions' && (
              <Button
                variant="outline" size="sm" leftIcon={<ArrowDownTrayIcon className="h-4 w-4" />}
                onClick={() => exportCsv('ai-wallet-ledger.csv', ['Date', 'Reference', 'Type', 'Amount', 'Balance After', 'Notes'],
                  (transactions.data?.rows ?? []).map((row) => [row.createdAt, row.referenceNo, row.type, row.amount, row.balanceAfter, row.notes]))}
              >
                Export CSV
              </Button>
            )}
            {tab === 'usage' && (
              <Button
                variant="outline" size="sm" leftIcon={<ArrowDownTrayIcon className="h-4 w-4" />}
                onClick={() => exportCsv('ai-usage.csv', ['Date', 'Provider', 'Model', 'Type', 'Prompt Tokens', 'Completion Tokens', 'Total Tokens', 'Charge', 'Status'],
                  (usage.data?.rows ?? []).map((row) => [row.createdAt, row.providerName, row.modelCode, row.callType, row.promptTokens, row.completionTokens, row.totalTokens, row.customerCharge, row.status]))}
              >
                Export CSV
              </Button>
            )}
          </div>
        </div>

        <div className="overflow-x-auto p-2">
          {tab === 'transactions' && (
            (transactions.data?.rows?.length ?? 0) === 0 ? (
              <EmptyState icon={<ReceiptRefundIcon className="h-10 w-10" />} title="No transactions yet" description="Purchases and AI usage charges will appear here." />
            ) : (
              <table className="min-w-full divide-y divide-secondary-100 text-sm dark:divide-secondary-800">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-secondary-500">
                    <th className="px-3 py-2">Date</th><th className="px-3 py-2">Reference</th><th className="px-3 py-2">Type</th>
                    <th className="px-3 py-2 text-right">Amount</th><th className="px-3 py-2 text-right">Balance</th><th className="px-3 py-2">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-secondary-50 dark:divide-secondary-800/60">
                  {transactions.data!.rows.map((row) => (
                    <tr key={row.id}>
                      <td className="whitespace-nowrap px-3 py-2 text-secondary-600 dark:text-secondary-300">{new Date(row.createdAt).toLocaleString()}</td>
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-secondary-500">{row.referenceNo}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-secondary-700 dark:text-secondary-300">{LEDGER_LABELS[row.type] ?? row.type}</td>
                      <td className={`whitespace-nowrap px-3 py-2 text-right font-medium tabular-nums ${Number(row.amount) >= 0 ? 'text-green-600' : 'text-secondary-900 dark:text-white'}`}>
                        {Number(row.amount) >= 0 ? '+' : ''}{money(row.amount, currency)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-secondary-600 dark:text-secondary-300">{money(row.balanceAfter, currency)}</td>
                      <td className="max-w-xs truncate px-3 py-2 text-secondary-500" title={row.notes ?? ''}>{row.notes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          )}

          {tab === 'usage' && (
            (usage.data?.rows?.length ?? 0) === 0 ? (
              <EmptyState icon={<SparklesIcon className="h-10 w-10" />} title="No AI usage yet" description="Every AI request is metered here with its token counts and charge." />
            ) : (
              <table className="min-w-full divide-y divide-secondary-100 text-sm dark:divide-secondary-800">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-secondary-500">
                    <th className="px-3 py-2">Date</th><th className="px-3 py-2">Model</th><th className="px-3 py-2">Type</th>
                    <th className="px-3 py-2 text-right">Tokens</th><th className="px-3 py-2 text-right">Charge</th><th className="px-3 py-2">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-secondary-50 dark:divide-secondary-800/60">
                  {usage.data!.rows.map((row) => (
                    <tr key={row.id}>
                      <td className="whitespace-nowrap px-3 py-2 text-secondary-600 dark:text-secondary-300">{new Date(row.createdAt).toLocaleString()}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-secondary-700 dark:text-secondary-300">{row.modelCode}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-secondary-500">{row.callType}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-secondary-600 dark:text-secondary-300">{row.totalTokens.toLocaleString()}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums font-medium text-secondary-900 dark:text-white">{money(row.customerCharge, currency)}</td>
                      <td className="px-3 py-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${row.status === 'CHARGED' ? 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300' : row.status === 'FAILED' ? 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300' : 'bg-secondary-100 text-secondary-600 dark:bg-secondary-800'}`}>
                          {row.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          )}

          {tab === 'purchases' && (
            (purchases.data?.rows?.length ?? 0) === 0 ? (
              <EmptyState icon={<CreditCardIcon className="h-10 w-10" />} title="No purchases yet" description="Buy credits by card (instant) or bank transfer (reviewed)." />
            ) : (
              <table className="min-w-full divide-y divide-secondary-100 text-sm dark:divide-secondary-800">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-secondary-500">
                    <th className="px-3 py-2">Date</th><th className="px-3 py-2">Method</th><th className="px-3 py-2 text-right">Amount</th>
                    <th className="px-3 py-2">Status</th><th className="px-3 py-2">Review Note</th><th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-secondary-50 dark:divide-secondary-800/60">
                  {purchases.data!.rows.map((row) => (
                    <tr key={row.id}>
                      <td className="whitespace-nowrap px-3 py-2 text-secondary-600 dark:text-secondary-300">{new Date(row.createdAt).toLocaleString()}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-secondary-700 dark:text-secondary-300">{row.method === 'STRIPE' ? 'Card (Stripe)' : 'Bank Transfer'}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums font-medium">{money(row.amount, row.currency)}</td>
                      <td className="px-3 py-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${row.status === 'COMPLETED' ? 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300' : row.status === 'PENDING' ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' : 'bg-secondary-100 text-secondary-600 dark:bg-secondary-800'}`}>
                          {row.status}
                        </span>
                      </td>
                      <td className="max-w-xs truncate px-3 py-2 text-secondary-500" title={row.reviewNote ?? ''}>{row.reviewNote}</td>
                      <td className="px-3 py-2 text-right">
                        {row.status === 'PENDING' && row.method === 'BANK_TRANSFER' && (
                          <button
                            type="button"
                            className="text-xs font-medium text-red-600 hover:text-red-700"
                            onClick={() => aiBillingService.cancelPurchase(row.id).then(() => { toast.success('Purchase cancelled'); refreshAll(); })}
                          >
                            Cancel
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          )}

          {tab === 'disputes' && (
            (disputes.data?.rows?.length ?? 0) === 0 ? (
              <EmptyState icon={<ExclamationTriangleIcon className="h-10 w-10" />} title="No disputes" description="Disagree with a charge? Raise a dispute and our team will investigate." />
            ) : (
              <ul className="divide-y divide-secondary-100 dark:divide-secondary-800">
                {disputes.data!.rows.map((dispute) => (
                  <li key={dispute.id} className="flex items-center justify-between gap-3 px-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-secondary-900 dark:text-white">{dispute.subject}</p>
                      <p className="text-xs text-secondary-500">{DISPUTE_TYPES.find((t) => t.value === dispute.type)?.label} · {new Date(dispute.createdAt).toLocaleDateString()}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${dispute.status === 'RESOLVED' ? 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300' : dispute.status === 'CLOSED' ? 'bg-secondary-100 text-secondary-600 dark:bg-secondary-800' : 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'}`}>
                        {dispute.status.replace(/_/g, ' ')}
                      </span>
                      <Button variant="outline" size="sm" onClick={() => setActiveDisputeId(dispute.id)}>View</Button>
                    </div>
                  </li>
                ))}
              </ul>
            )
          )}
        </div>
      </Card>

      <BuyCreditsModal open={buyOpen} onClose={() => { setBuyOpen(false); refreshAll(); }} />
      <RaiseDisputeModal open={disputeOpen} onClose={() => { setDisputeOpen(false); refreshAll(); }} />
      {activeDisputeId && <DisputeThreadModal disputeId={activeDisputeId} onClose={() => { setActiveDisputeId(null); refreshAll(); }} />}
    </div>
  );
}

function BuyCreditsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [amount, setAmount] = useState(50);
  const [method, setMethod] = useState<'card' | 'bank'>('card');
  const [proofUrl, setProofUrl] = useState('');
  const [proofNote, setProofNote] = useState('');

  const checkout = useMutation({
    mutationFn: () => aiBillingService.stripeCheckout(amount),
    onSuccess: ({ checkoutUrl }) => { window.location.href = checkoutUrl; },
    onError: (error: unknown) => toast.error(apiErrorMessage(error) ??'Could not start checkout'),
  });
  const bank = useMutation({
    mutationFn: () => aiBillingService.submitBankTransfer({ amount, proofUrl: proofUrl || undefined, proofNote: proofNote || undefined }),
    onSuccess: () => { toast.success('Submitted for review — credits arrive after approval'); onClose(); },
    onError: (error: unknown) => toast.error(apiErrorMessage(error) ??'Could not submit transfer'),
  });

  return (
    <Modal isOpen={open} onClose={onClose} title="Buy AI Credits">
      <div className="space-y-4">
        <div className="grid grid-cols-4 gap-2">
          {[20, 50, 100, 250].map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => setAmount(preset)}
              className={`rounded-lg border px-3 py-2 text-sm font-medium ${amount === preset ? 'border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-900/40' : 'border-secondary-200 text-secondary-700 dark:border-secondary-700 dark:text-secondary-300'}`}
            >
              ${preset}
            </button>
          ))}
        </div>
        <div>
          <label className="text-xs font-medium text-secondary-600 dark:text-secondary-400">Custom amount (USD)</label>
          <input
            type="number" min={1} value={amount}
            onChange={(event) => setAmount(Math.max(1, Number(event.target.value)))}
            className="mt-1 w-full rounded-lg border border-secondary-200 px-3 py-2 text-sm dark:border-secondary-700 dark:bg-secondary-900 dark:text-white"
          />
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => setMethod('card')} className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium ${method === 'card' ? 'border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-900/40' : 'border-secondary-200 text-secondary-600 dark:border-secondary-700 dark:text-secondary-400'}`}>
            Card (instant)
          </button>
          <button type="button" onClick={() => setMethod('bank')} className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium ${method === 'bank' ? 'border-primary-500 bg-primary-50 text-primary-700 dark:bg-primary-900/40' : 'border-secondary-200 text-secondary-600 dark:border-secondary-700 dark:text-secondary-400'}`}>
            Bank transfer (reviewed)
          </button>
        </div>
        {method === 'bank' && (
          <div className="space-y-2">
            <input
              type="url" placeholder="Payment proof URL (receipt/screenshot link)"
              value={proofUrl} onChange={(event) => setProofUrl(event.target.value)}
              className="w-full rounded-lg border border-secondary-200 px-3 py-2 text-sm dark:border-secondary-700 dark:bg-secondary-900 dark:text-white"
            />
            <textarea
              placeholder="Transfer reference / note for the reviewer"
              value={proofNote} onChange={(event) => setProofNote(event.target.value)} rows={3}
              className="w-full rounded-lg border border-secondary-200 px-3 py-2 text-sm dark:border-secondary-700 dark:bg-secondary-900 dark:text-white"
            />
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          {method === 'card' ? (
            <Button onClick={() => checkout.mutate()} disabled={checkout.isPending}>
              Pay {`$${amount}`} with Card
            </Button>
          ) : (
            <Button onClick={() => bank.mutate()} disabled={bank.isPending || (!proofUrl && !proofNote)}>
              Submit for Review
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}

function RaiseDisputeModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [type, setType] = useState<AiDisputeType>('UNEXPECTED_CHARGE');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const create = useMutation({
    mutationFn: () => aiBillingService.createDispute({ type, subject, description }),
    onSuccess: () => { toast.success('Dispute submitted — we will investigate'); onClose(); },
    onError: (error: unknown) => toast.error(apiErrorMessage(error) ??'Could not submit dispute'),
  });
  return (
    <Modal isOpen={open} onClose={onClose} title="Raise a Billing Dispute">
      <div className="space-y-3">
        <select
          value={type} onChange={(event) => setType(event.target.value as AiDisputeType)}
          className="w-full rounded-lg border border-secondary-200 px-3 py-2 text-sm dark:border-secondary-700 dark:bg-secondary-900 dark:text-white"
        >
          {DISPUTE_TYPES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <input
          placeholder="Subject" value={subject} onChange={(event) => setSubject(event.target.value)}
          className="w-full rounded-lg border border-secondary-200 px-3 py-2 text-sm dark:border-secondary-700 dark:bg-secondary-900 dark:text-white"
        />
        <textarea
          placeholder="Describe what happened — include dates, amounts, and references from your ledger"
          value={description} onChange={(event) => setDescription(event.target.value)} rows={5}
          className="w-full rounded-lg border border-secondary-200 px-3 py-2 text-sm dark:border-secondary-700 dark:bg-secondary-900 dark:text-white"
        />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => create.mutate()} disabled={create.isPending || !subject.trim() || !description.trim()}>Submit Dispute</Button>
        </div>
      </div>
    </Modal>
  );
}

function DisputeThreadModal({ disputeId, onClose }: { disputeId: string; onClose: () => void }) {
  const [reply, setReply] = useState('');
  const queryClient = useQueryClient();
  const dispute = useQuery({ queryKey: ['ai-billing', 'dispute', disputeId], queryFn: () => aiBillingService.getDispute(disputeId) });
  const send = useMutation({
    mutationFn: () => aiBillingService.replyDispute(disputeId, reply),
    onSuccess: () => { setReply(''); queryClient.invalidateQueries({ queryKey: ['ai-billing', 'dispute', disputeId] }); },
  });
  return (
    <Modal isOpen onClose={onClose} title={dispute.data?.subject ?? 'Dispute'}>
      <div className="space-y-3">
        <div className="max-h-72 space-y-2 overflow-y-auto">
          <p className="rounded-lg bg-secondary-50 p-3 text-sm text-secondary-700 dark:bg-secondary-800 dark:text-secondary-300">{dispute.data?.description}</p>
          {(dispute.data?.messages ?? []).map((message) => (
            <div key={message.id} className={`rounded-lg p-3 text-sm ${message.authorRole === 'ADMIN' ? 'bg-primary-50 text-primary-900 dark:bg-primary-900/30 dark:text-primary-200' : message.authorRole === 'SYSTEM' ? 'bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200' : 'bg-secondary-50 text-secondary-700 dark:bg-secondary-800 dark:text-secondary-300'}`}>
              <p className="mb-1 text-[10px] font-semibold uppercase opacity-70">{message.authorRole}</p>
              {message.body}
            </div>
          ))}
        </div>
        {dispute.data && dispute.data.status !== 'CLOSED' && (
          <div className="flex gap-2">
            <input
              value={reply} onChange={(event) => setReply(event.target.value)} placeholder="Reply…"
              className="flex-1 rounded-lg border border-secondary-200 px-3 py-2 text-sm dark:border-secondary-700 dark:bg-secondary-900 dark:text-white"
            />
            <Button size="sm" onClick={() => send.mutate()} disabled={!reply.trim() || send.isPending}>Send</Button>
          </div>
        )}
      </div>
    </Modal>
  );
}
