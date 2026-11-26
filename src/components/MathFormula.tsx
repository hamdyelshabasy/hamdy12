import React, { useMemo } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';

interface MathFormulaProps {
  formula: string;
  block?: boolean;
  className?: string;
}

export const MathFormula: React.FC<MathFormulaProps> = ({ formula, block = false, className = '' }) => {
  const html = useMemo(() => {
    try {
      return katex.renderToString(formula, {
        displayMode: block,
        throwOnError: false,
        strict: false,
        trust: false,
      });
    } catch {
      return null;
    }
  }, [formula, block]);

  if (html === null) {
    if (block) {
      return (
        <div
          dir="ltr"
          className={`my-3 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-center text-slate-900 ${className}`}
        >
          {formula}
        </div>
      );
    }
    return (
      <span dir="ltr" className={`math-ltr px-1 ${className}`}>
        {formula}
      </span>
    );
  }

  if (block) {
    return (
      <div
        dir="ltr"
        className={`my-3 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-center text-slate-900 ${className}`}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }

  return (
    <span
      dir="ltr"
      className={`math-ltr px-1 ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
};
