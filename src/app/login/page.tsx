// src/app/login/page.tsx  — server component
import LoginForm from "@/components/auth/LoginForm";

export default function LoginPage() {
  const iconSrc = (process.env.NEXT_PUBLIC_BASE_PATH ?? "") + "/icon.png";
  return <LoginForm iconSrc={iconSrc} />;
}
