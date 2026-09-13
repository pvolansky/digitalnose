import { Shell } from '@/components/shell';
import { DemoSettings } from '@/components/demo-settings';
export default function DemoSettingsPage() {
  return (
    <Shell demo>
      <div className="page-heading">
        <p className="eyebrow">Example site · owner</p>
        <h1>Your space.</h1>
        <p className="muted">
          Explore settings with fictional details. Changes stay on this page and reset when you
          leave.
        </p>
      </div>
      <DemoSettings />
    </Shell>
  );
}
