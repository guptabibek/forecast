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
  "Production.tsx",
  "BOM.tsx"
];

const basePath = "d:/RabbitTech/forecast-saas/apps/web/src/pages/manufacturing";

for (const file of files) {
  const filePath = path.join(basePath, file);
  if (!fs.existsSync(filePath)) {
    console.log(`Skipping ${file} - not found`);
    continue;
  }
  
  let content = fs.readFileSync(filePath, 'utf8');
  let originalContent = content;

  // Track if we need to add imports
  let needsConfirmImport = false;
  let needsDialogImport = false;

  // Special handling for BOM.tsx
  if (file === 'BOM.tsx') {
    // 1. Import PromptModal
    if (!content.includes('PromptModal')) {
      content = content.replace(
        "import { Badge, Button, Card, CardHeader, Column, DataTable, Modal, ProductSelector, QueryErrorBanner } from '@components/ui';",
        "import { Badge, Button, Card, CardHeader, Column, DataTable, Modal, ProductSelector, PromptModal, QueryErrorBanner } from '@components/ui';"
      );
    }
    
    // 2. Import useConfirmAction
    if (!content.includes('useConfirmAction')) {
      content = content.replace(
        "import { useGridState } from '@/hooks/useGridState';",
        "import { useGridState } from '@/hooks/useGridState';\nimport { useConfirmAction } from '@/hooks/useConfirmAction';"
      );
    }

    // 3. Import ConfirmDialog
    if (!content.includes('ConfirmDialog')) {
      content = content.replace(
        "import { format } from 'date-fns';",
        "import { format } from 'date-fns';\nimport { ConfirmDialog } from '@components/common/ConfirmDialog';"
      );
    }

    // 4. Add states
    if (!content.includes('const [showCopyPrompt, setShowCopyPrompt]')) {
      content = content.replace(
        "const [componentProductId, setComponentProductId] = useState('');",
        "const [componentProductId, setComponentProductId] = useState('');\n  const [showCopyPrompt, setShowCopyPrompt] = useState(false);\n  const [bomToCopy, setBomToCopy] = useState<BOM | null>(null);"
      );
    }

    // 5. Add confirm hook
    if (!content.includes('const confirmRemove = useConfirmAction')) {
      content = content.replace(
        "const grid = useGridState({ initialSortBy: 'createdAt', initialSortOrder: 'desc' });",
        `const grid = useGridState({ initialSortBy: 'createdAt', initialSortOrder: 'desc' });
  const confirmRemove = useConfirmAction({
    title: 'Remove Component',
    message: 'Are you sure you want to remove this component?',
    variant: 'danger',
    confirmText: 'Remove'
  });`
      );
    }

    // 6. Replace prompt()
    content = content.replace(
      /const handleCopyBOM = \(bom: BOM\) => \{[\s\S]*?const newRevision = prompt\('Enter new revision number:', `\$\{bom\.revision\}-copy`\);[\s\S]*?if \(newRevision\) \{[\s\S]*?copyMutation\.mutate\(\{ id: bom\.id, targetProductId: bom\.productId, newRevision \}\);[\s\S]*?\}[\s\S]*?\};/,
      `const handleCopyBOM = (bom: BOM) => {
    setBomToCopy(bom);
    setShowCopyPrompt(true);
  };`
    );

    // 7. Replace confirm()
    content = content.replace(
      /onClick=\{.*?if \(confirm\('Remove this component\?'\)\) removeComponentMutation\.mutate\(comp\.id\); \}\}/,
      `onClick={() => confirmRemove.confirm(() => removeComponentMutation.mutate(comp.id))}`
    );

    // 8. Add Modals to JSX
    if (!content.includes('<PromptModal')) {
      content = content.replace(
        /<\/div>\s*?\);\s*?\}\s*$/,
        `      <PromptModal
        isOpen={showCopyPrompt}
        onClose={() => setShowCopyPrompt(false)}
        title="Copy BOM"
        message="Enter a new revision number for the copied BOM:"
        initialValue={bomToCopy ? \`\${bomToCopy.revision}-copy\` : ''}
        inputLabel="Revision Number"
        confirmText="Copy"
        onConfirm={(val) => {
          if (bomToCopy) {
            copyMutation.mutate({ id: bomToCopy.id, targetProductId: bomToCopy.productId, newRevision: val });
          }
          setShowCopyPrompt(false);
        }}
        required
      />
      <ConfirmDialog {...confirmRemove.confirmProps} />
    </div>
  );
}`
      );
    }
  } else {
    // General handling for other files
    
    // Check if we have matches for confirm
    const confirmMatches = [...content.matchAll(/if\s*\(\s*confirm\s*\(\s*['"`](.*?)['"`]\s*\)\s*\)\s*(.*?\.mutate[A-Za-z0-9]*\([^)]*\));/g)];
    
    if (confirmMatches.length > 0) {
      needsConfirmImport = true;
      needsDialogImport = true;

      let hookDeclarations = '';
      let dialogComponents = '';

      // We'll create a unique hook for each match to avoid sharing state if they are different
      confirmMatches.forEach((match, idx) => {
        const fullMatch = match[0];
        const message = match[1].replace(/"/g, "'"); // Escape quotes
        const mutationCall = match[2];
        const hookName = `confirmAction${idx + 1}`;

        // Add hook declaration
        hookDeclarations += `\n  const ${hookName} = useConfirmAction({
    title: 'Confirm Action',
    message: "${message}",
    variant: 'danger',
  });`;

        // Add dialog component
        dialogComponents += `\n      <ConfirmDialog {...${hookName}.confirmProps} />`;

        // Replace the inline call
        const replacement = `${hookName}.confirm(() => ${mutationCall})`;
        // Because the original is likely inside an arrow function e.g. () => { if(...) ... }
        // Let's replace the if statement entirely
        content = content.replace(fullMatch, replacement);
      });

      // Insert imports
      if (!content.includes('useConfirmAction')) {
        // Find last import
        const imports = content.match(/import .*?;/g);
        if (imports && imports.length > 0) {
          const lastImport = imports[imports.length - 1];
          content = content.replace(
            lastImport,
            `${lastImport}\nimport { useConfirmAction } from '@/hooks/useConfirmAction';`
          );
        }
      }

      if (!content.includes('ConfirmDialog')) {
        const imports = content.match(/import .*?;/g);
        if (imports && imports.length > 0) {
          const lastImport = imports[imports.length - 1];
          content = content.replace(
            lastImport,
            `${lastImport}\nimport { ConfirmDialog } from '@components/common/ConfirmDialog';`
          );
        }
      }

      // Insert hooks inside component (look for the first useQuery or useState or const createMutation etc.)
      const hookInsertionPoint = content.match(/const [a-zA-Z0-9_]+ = use(Query|State|Mutation|GridState|Navigate)[^;]*;/);
      if (hookInsertionPoint) {
        content = content.replace(
          hookInsertionPoint[0],
          `${hookDeclarations}\n  ${hookInsertionPoint[0]}`
        );
      } else {
         // fallback to find the export default function
         const compMatch = content.match(/export default function [a-zA-Z0-9_]+\(.*\) \{/);
         if (compMatch) {
            content = content.replace(
              compMatch[0],
              `${compMatch[0]}\n${hookDeclarations}`
            );
         }
      }

      // Insert dialogs before closing div
      content = content.replace(
        /<\/div>\s*?\);\s*?\}\s*$/,
        `${dialogComponents}\n    </div>\n  );\n}`
      );
      
      // Some files use <Fragment> instead of <div> at the root
      if (originalContent === content) {
        content = content.replace(
          /<\/>\s*?\);\s*?\}\s*$/,
          `${dialogComponents}\n    </>\n  );\n}`
        );
      }
    }
  }

  if (content !== originalContent) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Updated ${file}`);
  }
}
