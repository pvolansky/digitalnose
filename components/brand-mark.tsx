import Image from 'next/image';

export function BrandMark() {
  return <Image src="/logo.svg" alt="" aria-hidden="true" width={34} height={34} unoptimized />;
}
