import * as React from 'react';

type Props = {
  className?: string;
  variant?: 'horizontal' | 'small';
  alt?: string;
};

export function SellAvantLogo({
  className,
  variant = 'horizontal',
  alt = 'SellAvant',
}: Props) {
  const src =
    variant === 'small'
      ? '/brand/sellavant-logo-small.svg'
      : '/brand/sellavant-logo-horizontal.svg';

  return <img src={src} alt={alt} className={className} />;
}
