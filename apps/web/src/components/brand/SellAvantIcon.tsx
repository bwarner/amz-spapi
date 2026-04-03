import * as React from 'react';

type Props = React.SVGProps<SVGSVGElement> & {
  gold?: string;
};

export function SellAvantIcon({ gold = '#C89B3C', ...props }: Props) {
  return (
    <svg
      viewBox="0 0 256 256"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <rect
        x="18"
        y="18"
        width="220"
        height="220"
        rx="34"
        stroke="currentColor"
        strokeWidth="10"
      />
      <path
        d="M114 54c-30 0-53 16-53 39 0 17 10 28 33 36l28 10c16 6 23 12 23 21 0 12-13 21-31 21-19 0-34-8-45-21l-20 24c16 17 38 27 65 27 40 0 68-20 68-51 0-24-14-38-44-48l-25-9c-12-4-17-9-17-16 0-10 11-17 27-17 15 0 29 6 40 16l16-27c-15-12-37-20-65-20z"
        fill="currentColor"
      />
      <path
        d="M72 188c39-4 69-20 95-58 13-19 26-47 31-74l26 7c-8 35-23 64-42 89-29 37-64 54-110 58v-22z"
        fill={gold}
      />
      <path d="M196 42l31 72-61-18 30-54z" fill={gold} />
    </svg>
  );
}
