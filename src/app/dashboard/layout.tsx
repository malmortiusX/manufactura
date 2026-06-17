// src/app/dashboard/layout.tsx
import Sidebar from "@/components/layout/Sidebar";
import Topbar from "@/components/layout/Topbar";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const iconSrc = (process.env.NEXT_PUBLIC_BASE_PATH ?? "") + "/icon.png";

  return (
    <div className="flex h-screen bg-slate-100 overflow-hidden">
      <Sidebar iconSrc={iconSrc} />
      <div className="flex-1 flex flex-col ml-64 overflow-hidden">
        <Topbar />
        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
