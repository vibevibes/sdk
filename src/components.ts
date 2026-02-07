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
