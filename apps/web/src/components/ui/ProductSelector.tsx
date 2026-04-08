import { dataService } from '@services/api';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface ProductOption {
  id: string;
  code: string;
  name: string;
  category?: string;
  listPrice?: number;
  standardCost?: number;
  unitOfMeasure?: string;
  [key: string]: unknown;
}

interface ProductSelectorProps {
  value?: string;
  onChange: (productId: string, product: ProductOption | null) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  excludeIds?: string[];
  /** Filter by category */
  category?: string;
  /** Show only active products */
  activeOnly?: boolean;
}

export function ProductSelector({
  value,
  onChange,
  placeholder = 'Search products...',
  disabled = false,
  className = '',
  excludeIds = [],
  activeOnly = true,
}: ProductSelectorProps) {
  const [search, setSearch] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Fetch products with search debounce
  const { data: products = [], isLoading } = useQuery({
    queryKey: ['products-selector', search, activeOnly],
    queryFn: () =>
      dataService.getProducts({
        search: search || undefined,
        isActive: activeOnly ? true : undefined,
        limit: 200,
      }),
    staleTime: 30_000,
  });

  // Filter out excluded IDs and apply category filter
  const filteredProducts = useMemo(() => {
    const list = (products as unknown as ProductOption[]).filter(
      (p) => !excludeIds.includes(p.id),
    );
    return list;
  }, [products, excludeIds]);

  // Currently selected product
  const selectedProduct = useMemo(() => {
    if (!value) return null;
    return filteredProducts.find((p) => p.id === value) || null;
  }, [value, filteredProducts]);

  // Close dropdown on outside click
  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  // Scroll highlighted item into view
  useEffect(() => {
    if (highlightIndex >= 0 && listRef.current) {
      const el = listRef.current.children[highlightIndex] as HTMLElement;
      el?.scrollIntoView({ block: 'nearest' });
    }
  }, [highlightIndex]);

  const handleSelect = useCallback(
    (product: ProductOption) => {
      onChange(product.id, product);
      setSearch('');
      setIsOpen(false);
      setHighlightIndex(-1);
    },
    [onChange],
  );

  const handleClear = useCallback(() => {
    onChange('', null);
    setSearch('');
    setHighlightIndex(-1);
  }, [onChange]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        setIsOpen(true);
        e.preventDefault();
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightIndex((i) =>
          i < filteredProducts.length - 1 ? i + 1 : 0,
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightIndex((i) =>
          i > 0 ? i - 1 : filteredProducts.length - 1,
        );
        break;
      case 'Enter':
        e.preventDefault();
        if (highlightIndex >= 0 && filteredProducts[highlightIndex]) {
          handleSelect(filteredProducts[highlightIndex]);
        }
        break;
      case 'Escape':
        setIsOpen(false);
        setHighlightIndex(-1);
        break;
    }
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {/* Selected value display or search input */}
      {value && selectedProduct && !isOpen ? (
        <div
          className={`flex items-center justify-between w-full px-3 py-2 border rounded-md dark:bg-gray-800 dark:border-gray-700 bg-white cursor-pointer ${
            disabled ? 'opacity-60 cursor-not-allowed' : 'hover:border-primary-400'
          }`}
          onClick={() => {
            if (!disabled) {
              setIsOpen(true);
              setTimeout(() => inputRef.current?.focus(), 0);
            }
          }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs font-mono bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded">
              {selectedProduct.code}
            </span>
            <span className="truncate text-sm">{selectedProduct.name}</span>
            {selectedProduct.listPrice != null && (
              <span className="text-xs text-secondary-500 ml-auto flex-shrink-0">
                ${Number(selectedProduct.listPrice).toFixed(2)}
              </span>
            )}
          </div>
          {!disabled && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleClear();
              }}
              className="ml-2 text-gray-400 hover:text-red-500 flex-shrink-0"
              title="Clear"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      ) : (
        <div className="relative">
          <input
            ref={inputRef}
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setIsOpen(true);
              setHighlightIndex(-1);
            }}
            onFocus={() => setIsOpen(true)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled}
            className={`w-full px-3 py-2 border rounded-md dark:bg-gray-800 dark:border-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-primary-500 ${
              disabled ? 'opacity-60 cursor-not-allowed' : ''
            }`}
          />
          {isLoading && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              <svg className="animate-spin h-4 w-4 text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            </div>
          )}
          {search && (
            <button
              type="button"
              onClick={() => {
                setSearch('');
                inputRef.current?.focus();
              }}
              className="absolute right-8 top-1/2 -translate-y-1/2 text-gray-400 hover:text-red-500"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      )}

      {/* Dropdown */}
      {isOpen && !disabled && (
        <ul
          ref={listRef}
          className="absolute z-50 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg max-h-60 overflow-auto"
        >
          {filteredProducts.length === 0 ? (
            <li className="px-3 py-3 text-sm text-gray-500 text-center">
              {isLoading ? 'Loading...' : 'No products found'}
            </li>
          ) : (
            filteredProducts.map((product, idx) => (
              <li
                key={product.id}
                onClick={() => handleSelect(product)}
                onMouseEnter={() => setHighlightIndex(idx)}
                className={`px-3 py-2 cursor-pointer text-sm flex items-center justify-between gap-2 ${
                  idx === highlightIndex
                    ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300'
                    : 'hover:bg-gray-50 dark:hover:bg-gray-700'
                } ${product.id === value ? 'font-medium' : ''}`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs font-mono bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded flex-shrink-0">
                    {product.code}
                  </span>
                  <span className="truncate">{product.name}</span>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0 text-xs text-secondary-500">
                  {product.category && (
                    <span className="hidden sm:inline">{product.category}</span>
                  )}
                  {product.listPrice != null && (
                    <span>${Number(product.listPrice).toFixed(2)}</span>
                  )}
                </div>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
