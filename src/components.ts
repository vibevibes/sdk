/**
 * Pre-built UI components for experiences.
 *
 * These components use inline styles (no Tailwind dependency) so they work
 * reliably inside bundled experience canvases. They provide sensible defaults
 * and can be overridden via the `style` prop.
 *
 * Usage in experiences:
 *   import { Button, Card, Input, Badge, Stack, Grid } from "@vibevibes/experience-sdk";
 */

// Lazy React accessor (same pattern as hooks.ts)
function getReact(): any {
  const R = (globalThis as any).React;
  if (!R) throw new Error('React is not available.');
  return R;
}

function h(type: string, props: any, ...children: any[]) {
  return getReact().createElement(type, props, ...children);
}

// ─── Button ──────────────────────────────────────────────────────────────────

type ButtonProps = {
  children?: any;
  onClick?: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  style?: Record<string, any>;
};

const buttonColors = {
  primary: { bg: '#6366f1', text: '#fff', hover: '#4f46e5' },
  secondary: { bg: '#f3f4f6', text: '#374151', hover: '#e5e7eb' },
  danger: { bg: '#ef4444', text: '#fff', hover: '#dc2626' },
  ghost: { bg: 'transparent', text: '#6b7280', hover: '#f3f4f6' },
};

const buttonSizes = {
  sm: { padding: '0.375rem 0.75rem', fontSize: '0.8125rem' },
  md: { padding: '0.5rem 1rem', fontSize: '0.875rem' },
  lg: { padding: '0.625rem 1.25rem', fontSize: '1rem' },
};

export function Button({ children, onClick, disabled, variant = 'primary', size = 'md', style }: ButtonProps) {
  const colors = buttonColors[variant];
  const sizeStyles = buttonSizes[size];
  return h('button', {
    onClick,
    disabled,
    style: {
      ...sizeStyles,
      backgroundColor: colors.bg,
      color: colors.text,
      border: 'none',
      borderRadius: '0.5rem',
      fontWeight: 500,
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.5 : 1,
      transition: 'background-color 0.15s, opacity 0.15s',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      lineHeight: 1.5,
      ...style,
    },
  }, children);
}

// ─── Card ────────────────────────────────────────────────────────────────────

type CardProps = {
  children?: any;
  title?: string;
  style?: Record<string, any>;
};

export function Card({ children, title, style }: CardProps) {
  return h('div', {
    style: {
      backgroundColor: '#fff',
      border: '1px solid #e5e7eb',
      borderRadius: '0.75rem',
      padding: '1.25rem',
      boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
      ...style,
    },
  },
    title ? h('h3', {
      style: { margin: '0 0 0.75rem 0', fontSize: '1rem', fontWeight: 600, color: '#111827' }
    }, title) : null,
    children,
  );
}

// ─── Input ───────────────────────────────────────────────────────────────────

type InputProps = {
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  type?: string;
  disabled?: boolean;
  style?: Record<string, any>;
};

export function Input({ value, onChange, placeholder, type = 'text', disabled, style }: InputProps) {
  return h('input', {
    type,
    value,
    placeholder,
    disabled,
    onChange: onChange ? (e: any) => onChange(e.target.value) : undefined,
    style: {
      width: '100%',
      padding: '0.5rem 0.75rem',
      fontSize: '0.875rem',
      border: '1px solid #d1d5db',
      borderRadius: '0.5rem',
      outline: 'none',
      backgroundColor: disabled ? '#f9fafb' : '#fff',
      color: '#111827',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      lineHeight: 1.5,
      boxSizing: 'border-box' as const,
      ...style,
    },
  });
}

// ─── Badge ───────────────────────────────────────────────────────────────────

type BadgeProps = {
  children?: any;
  color?: 'gray' | 'blue' | 'green' | 'red' | 'yellow' | 'purple';
  style?: Record<string, any>;
};

const badgeColors = {
  gray: { bg: '#f3f4f6', text: '#374151' },
  blue: { bg: '#dbeafe', text: '#1d4ed8' },
  green: { bg: '#dcfce7', text: '#15803d' },
  red: { bg: '#fee2e2', text: '#b91c1c' },
  yellow: { bg: '#fef9c3', text: '#a16207' },
  purple: { bg: '#f3e8ff', text: '#7e22ce' },
};

export function Badge({ children, color = 'gray', style }: BadgeProps) {
  const colors = badgeColors[color];
  return h('span', {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      padding: '0.125rem 0.625rem',
      fontSize: '0.75rem',
      fontWeight: 500,
      borderRadius: '9999px',
      backgroundColor: colors.bg,
      color: colors.text,
      fontFamily: 'system-ui, -apple-system, sans-serif',
      lineHeight: 1.5,
      ...style,
    },
  }, children);
}

// ─── Stack ───────────────────────────────────────────────────────────────────

type StackProps = {
  children?: any;
  direction?: 'row' | 'column';
  gap?: string | number;
  align?: string;
  justify?: string;
  style?: Record<string, any>;
};

export function Stack({ children, direction = 'column', gap = '0.5rem', align, justify, style }: StackProps) {
  return h('div', {
    style: {
      display: 'flex',
      flexDirection: direction,
      gap,
      alignItems: align,
      justifyContent: justify,
      ...style,
    },
  }, children);
}

// ─── Grid ────────────────────────────────────────────────────────────────────

type GridProps = {
  children?: any;
  columns?: number | string;
  gap?: string | number;
  style?: Record<string, any>;
};

export function Grid({ children, columns = 2, gap = '0.75rem', style }: GridProps) {
  return h('div', {
    style: {
      display: 'grid',
      gridTemplateColumns: typeof columns === 'number' ? `repeat(${columns}, 1fr)` : columns,
      gap,
      ...style,
    },
  }, children);
}

// ─── Slider ───────────────────────────────────────────────────────────────

type SliderProps = {
  value?: number;
  onChange?: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  label?: string;
  style?: Record<string, any>;
};

export function Slider({ value = 50, onChange, min = 0, max = 100, step = 1, disabled, label, style }: SliderProps) {
  const pct = ((value - min) / (max - min)) * 100;
  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '0.25rem', ...style } },
    label ? h('div', {
      style: { display: 'flex', justifyContent: 'space-between', fontSize: '0.8125rem', color: '#6b7280' },
    }, h('span', null, label), h('span', null, String(value))) : null,
    h('input', {
      type: 'range', min, max, step, value, disabled,
      onChange: onChange ? (e: any) => onChange(parseFloat(e.target.value)) : undefined,
      style: {
        width: '100%', height: '6px', appearance: 'none' as any, WebkitAppearance: 'none' as any,
        background: `linear-gradient(to right, #6366f1 ${pct}%, #d1d5db ${pct}%)`,
        borderRadius: '3px', outline: 'none', cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
      },
    }),
  );
}

// ─── Textarea ─────────────────────────────────────────────────────────────

type TextareaProps = {
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
  style?: Record<string, any>;
};

export function Textarea({ value, onChange, placeholder, rows = 3, disabled, style }: TextareaProps) {
  return h('textarea', {
    value, placeholder, rows, disabled,
    onChange: onChange ? (e: any) => onChange(e.target.value) : undefined,
    style: {
      width: '100%', padding: '0.5rem 0.75rem', fontSize: '0.875rem',
      border: '1px solid #d1d5db', borderRadius: '0.5rem', outline: 'none',
      backgroundColor: disabled ? '#f9fafb' : '#fff', color: '#111827',
      fontFamily: 'system-ui, -apple-system, sans-serif', lineHeight: 1.5,
      boxSizing: 'border-box' as const, resize: 'vertical' as const,
      ...style,
    },
  });
}

// ─── Modal ────────────────────────────────────────────────────────────────

type ModalProps = {
  children?: any;
  open?: boolean;
  onClose?: () => void;
  title?: string;
  style?: Record<string, any>;
};

export function Modal({ children, open = false, onClose, title, style }: ModalProps) {
  if (!open) return null;
  return h('div', {
    onClick: onClose,
    style: {
      position: 'fixed', inset: 0, zIndex: 10000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      backgroundColor: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)',
    },
  },
    h('div', {
      onClick: (e: any) => e.stopPropagation(),
      style: {
        backgroundColor: '#fff', borderRadius: '0.75rem', padding: '1.5rem',
        boxShadow: '0 20px 60px rgba(0,0,0,0.3)', maxWidth: '480px', width: '90%',
        maxHeight: '80vh', overflowY: 'auto' as const,
        ...style,
      },
    },
      title ? h('div', {
        style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' },
      },
        h('h3', { style: { margin: 0, fontSize: '1.1rem', fontWeight: 600, color: '#111827' } }, title),
        onClose ? h('button', {
          onClick: onClose,
          style: {
            background: 'none', border: 'none', fontSize: '1.25rem', cursor: 'pointer',
            color: '#6b7280', padding: '0.25rem',
          },
        }, '\u2715') : null,
      ) : null,
      children,
    ),
  );
}

// ─── ColorPicker ──────────────────────────────────────────────────────────

type ColorPickerProps = {
  value?: string;
  onChange?: (color: string) => void;
  presets?: string[];
  disabled?: boolean;
  style?: Record<string, any>;
};

const DEFAULT_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4',
  '#3b82f6', '#6366f1', '#8b5cf6', '#ec4899', '#111827',
  '#6b7280', '#ffffff',
];

export function ColorPicker({ value = '#6366f1', onChange, presets, disabled, style }: ColorPickerProps) {
  const colors = presets || DEFAULT_COLORS;
  return h('div', {
    style: { display: 'flex', flexWrap: 'wrap' as const, gap: '0.375rem', alignItems: 'center', ...style },
  },
    ...colors.map((color) =>
      h('button', {
        key: color,
        onClick: !disabled && onChange ? () => onChange(color) : undefined,
        style: {
          width: '28px', height: '28px', borderRadius: '50%', border: color === value ? '2px solid #111827' : '2px solid transparent',
          backgroundColor: color, cursor: disabled ? 'not-allowed' : 'pointer',
          outline: color === value ? '2px solid #6366f1' : 'none', outlineOffset: '2px',
          opacity: disabled ? 0.5 : 1, padding: 0,
        },
      }),
    ),
    h('input', {
      type: 'color', value, disabled,
      onChange: onChange ? (e: any) => onChange(e.target.value) : undefined,
      style: {
        width: '28px', height: '28px', padding: 0, border: 'none',
        borderRadius: '50%', cursor: disabled ? 'not-allowed' : 'pointer',
      },
    }),
  );
}

// ─── Dropdown ─────────────────────────────────────────────────────────────

type DropdownProps = {
  value?: string;
  onChange?: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
  disabled?: boolean;
  style?: Record<string, any>;
};

export function Dropdown({ value, onChange, options, placeholder, disabled, style }: DropdownProps) {
  return h('select', {
    value: value || '', disabled,
    onChange: onChange ? (e: any) => onChange(e.target.value) : undefined,
    style: {
      width: '100%', padding: '0.5rem 0.75rem', fontSize: '0.875rem',
      border: '1px solid #d1d5db', borderRadius: '0.5rem', outline: 'none',
      backgroundColor: disabled ? '#f9fafb' : '#fff', color: '#111827',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      cursor: disabled ? 'not-allowed' : 'pointer',
      appearance: 'none' as any,
      backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 12 12\'%3E%3Cpath d=\'M3 5l3 3 3-3\' fill=\'none\' stroke=\'%236b7280\' stroke-width=\'1.5\'/%3E%3C/svg%3E")',
      backgroundRepeat: 'no-repeat', backgroundPosition: 'right 0.75rem center',
      paddingRight: '2rem',
      ...style,
    },
  },
    placeholder ? h('option', { value: '', disabled: true }, placeholder) : null,
    ...options.map((opt) => h('option', { key: opt.value, value: opt.value }, opt.label)),
  );
}

// ─── Tabs ─────────────────────────────────────────────────────────────────

type TabsProps = {
  tabs: Array<{ id: string; label: string }>;
  activeTab?: string;
  onTabChange?: (id: string) => void;
  children?: any;
  style?: Record<string, any>;
};

export function Tabs({ tabs, activeTab, onTabChange, children, style }: TabsProps) {
  const active = activeTab || tabs[0]?.id;
  return h('div', { style: { ...style } },
    h('div', {
      style: {
        display: 'flex', borderBottom: '1px solid #e5e7eb', gap: 0,
      },
    },
      ...tabs.map((tab) =>
        h('button', {
          key: tab.id,
          onClick: onTabChange ? () => onTabChange(tab.id) : undefined,
          style: {
            padding: '0.5rem 1rem', fontSize: '0.8125rem', fontWeight: 500,
            background: 'none', border: 'none', cursor: 'pointer',
            color: tab.id === active ? '#6366f1' : '#6b7280',
            borderBottom: tab.id === active ? '2px solid #6366f1' : '2px solid transparent',
            marginBottom: '-1px',
            fontFamily: 'system-ui, -apple-system, sans-serif',
          },
        }, tab.label),
      ),
    ),
    h('div', { style: { paddingTop: '0.75rem' } }, children),
  );
}
