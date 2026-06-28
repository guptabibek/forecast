const fs = require('fs');
const path = require('path');

const files = [
  "BatchManagement.tsx",
  "Suppliers.tsx",
  "Promotions.tsx",
  "NPI.tsx",
  "SOP.tsx",
  "FiscalCalendar.tsx",
  "ForecastAccuracy.tsx",
  "LocationHierarchyPage.tsx",
  "ProductCategoryMaster.tsx",
  "ProductCosting.tsx",
  "QualityInspections.tsx",
  "SOPGapAnalysis.tsx",
  "PurchaseContracts.tsx",
  "UomConversions.tsx",
  "UomMaster.tsx",
  "Workflow.tsx",
  "Capacity.tsx",
  "CapacityPlansPage.tsx",
  "Production.tsx"
];

const basePath = "d:/RabbitTech/forecast-saas/apps/web/src/pages/manufacturing";

for (const file of files) {
  const filePath = path.join(basePath, file);
  if (!fs.existsSync(filePath)) continue;
  
  let content = fs.readFileSync(filePath, 'utf8');

  // Fix the props mismatch
  content = content.replace(
    /<ConfirmDialog \{\.\.\.([a-zA-Z0-9_]+)\.confirmProps\} \/>/g,
    `<ConfirmDialog open={$1.confirmProps.isOpen} onCancel={$1.confirmProps.onClose} onConfirm={$1.confirmProps.onConfirm} title={$1.confirmProps.title} message={$1.confirmProps.message} variant={$1.confirmProps.variant as any} confirmLabel={$1.confirmProps.confirmText} />`
  );

  // Fix Production.tsx hook declarations (it was injected outside the component)
  if (file === 'Production.tsx') {
    // The previous script might have messed up the imports or injected hooks badly
    content = content.replace(/const confirmAction[0-9]+ = useConfirmAction\(\{[\s\S]*?\}\);\n/g, '');
    
    // Check if we need to reinject them
    if (!content.includes('const confirmAction1 = useConfirmAction')) {
       const hookStr = `
  const confirmAction1 = useConfirmAction({ title: 'Confirm', message: 'Delete this line?', variant: 'danger' });
  const confirmAction2 = useConfirmAction({ title: 'Confirm', message: 'Delete this reason?', variant: 'danger' });
  const confirmAction3 = useConfirmAction({ title: 'Confirm', message: 'Delete?', variant: 'danger' });
  const confirmAction4 = useConfirmAction({ title: 'Confirm', message: 'Delete?', variant: 'danger' });
`;
       content = content.replace(/(export default function Production\(\) \{)/, `$1${hookStr}`);
    }
  }

  // Fix SOP.tsx hook declarations (injected after import)
  if (file === 'SOP.tsx') {
    content = content.replace(/import \{ ConfirmDialog \} from '@components\/common\/ConfirmDialog';\n\s*const confirmAction1 = useConfirmAction\(\{[\s\S]*?\}\);/g, "import { ConfirmDialog } from '@components/common/ConfirmDialog';");
    
    if (!content.includes('const confirmAction1 = useConfirmAction')) {
       const hookStr = `\n  const confirmAction1 = useConfirmAction({ title: 'Confirm', message: 'Delete?', variant: 'danger' });`;
       content = content.replace(/(export default function SOP\(\) \{)/, `$1${hookStr}`);
    }
    
    // Remove duplicate imports inside the file if they were injected in the wrong place
    content = content.replace(/import \{ useConfirmAction \} from '@\/hooks\/useConfirmAction';\nimport \{ ConfirmDialog \} from '@components\/common\/ConfirmDialog';\n(?!$)/g, "");
    
    // Add imports at top
    if (!content.includes("import { useConfirmAction } from '@/hooks/useConfirmAction'")) {
       content = `import { useConfirmAction } from '@/hooks/useConfirmAction';\nimport { ConfirmDialog } from '@components/common/ConfirmDialog';\n` + content;
    }
  }

  fs.writeFileSync(filePath, content, 'utf8');
}
