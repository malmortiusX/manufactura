"use client";
// src/app/dashboard/users/page.tsx
import { useEffect, useRef, useState } from "react";

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
  createdAt: string;
}

type UserModalMode = "create" | "edit";

interface UserModalState {
  open: boolean;
  mode: UserModalMode;
  userId: string;
  name: string;
  email: string;
  password: string;
  role: string;
}

interface PwdModalState {
  open: boolean;
  userId: string;
  userName: string;
}

const emptyUserModal: UserModalState = {
  open: false,
  mode: "create",
  userId: "",
  name: "",
  email: "",
  password: "",
  role: "user",
};

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Modal crear/editar
  const [userModal, setUserModal] = useState<UserModalState>(emptyUserModal);
  const [userModalError, setUserModalError] = useState("");
  const [userModalLoading, setUserModalLoading] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  const [togglingId, setTogglingId] = useState<string | null>(null);

  // Modal contraseña
  const [pwdModal, setPwdModal] = useState<PwdModalState>({ open: false, userId: "", userName: "" });
  const [pwd, setPwd] = useState("");
  const [pwdConfirm, setPwdConfirm] = useState("");
  const [pwdError, setPwdError] = useState("");
  const [pwdLoading, setPwdLoading] = useState(false);
  const [pwdSuccess, setPwdSuccess] = useState(false);
  const pwdRef = useRef<HTMLInputElement>(null);

  function loadUsers() {
    setLoading(true);
    fetch("/api/users")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setUsers(data);
        else setError("No se pudieron cargar los usuarios.");
      })
      .catch(() => setError("Error de conexión."))
      .finally(() => setLoading(false));
  }

  useEffect(() => { loadUsers(); }, []);

  // ── Modal crear/editar ──────────────────────────────────────────────────────

  function openCreate() {
    setUserModal({ ...emptyUserModal, open: true });
    setUserModalError("");
    setTimeout(() => nameRef.current?.focus(), 50);
  }

  function openEdit(u: User) {
    setUserModal({ open: true, mode: "edit", userId: u.id, name: u.name, email: u.email, password: "", role: u.role });
    setUserModalError("");
    setTimeout(() => nameRef.current?.focus(), 50);
  }

  function closeUserModal() {
    setUserModal(emptyUserModal);
  }

  async function handleUserSubmit(e: React.FormEvent) {
    e.preventDefault();
    setUserModalError("");
    setUserModalLoading(true);

    const isCreate = userModal.mode === "create";
    const url = isCreate ? "/api/users" : `/api/users/${userModal.userId}`;
    const method = isCreate ? "POST" : "PUT";

    const body: Record<string, string> = {
      name: userModal.name,
      email: userModal.email,
      role: userModal.role,
    };
    if (isCreate) body.password = userModal.password;

    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setUserModalError(data.error ?? "Error al guardar.");
      } else {
        closeUserModal();
        loadUsers();
      }
    } catch {
      setUserModalError("Error de conexión.");
    } finally {
      setUserModalLoading(false);
    }
  }

  // ── Toggle activo/bloqueado ─────────────────────────────────────────────────

  async function toggleActive(u: User) {
    setTogglingId(u.id);
    try {
      const res = await fetch(`/api/users/${u.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !u.active }),
      });
      if (res.ok) loadUsers();
    } finally {
      setTogglingId(null);
    }
  }

  // ── Modal contraseña ────────────────────────────────────────────────────────

  function openPwd(u: User) {
    setPwdModal({ open: true, userId: u.id, userName: u.name });
    setPwd("");
    setPwdConfirm("");
    setPwdError("");
    setPwdSuccess(false);
    setTimeout(() => pwdRef.current?.focus(), 50);
  }

  function closePwd() {
    setPwdModal({ open: false, userId: "", userName: "" });
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwdError("");
    if (pwd.length < 8) { setPwdError("La contraseña debe tener al menos 8 caracteres."); return; }
    if (pwd !== pwdConfirm) { setPwdError("Las contraseñas no coinciden."); return; }
    setPwdLoading(true);
    try {
      const res = await fetch(`/api/users/${pwdModal.userId}/password`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pwd }),
      });
      const data = await res.json();
      if (!res.ok) setPwdError(data.error ?? "Error al cambiar la contraseña.");
      else { setPwdSuccess(true); setTimeout(closePwd, 1200); }
    } catch {
      setPwdError("Error de conexión.");
    } finally {
      setPwdLoading(false);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">{users.length} usuarios registrados</p>
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-[#f89520] hover:bg-[#e07208] rounded-lg transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Nuevo usuario
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-slate-400">
            <svg className="animate-spin w-6 h-6 mr-2" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Cargando usuarios...
          </div>
        ) : error ? (
          <div className="text-center py-12 text-red-400 text-sm">{error}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Usuario</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Rol</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Registrado</th>
                  <th className="px-5 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-[#f89520] flex items-center justify-center text-white text-xs font-semibold">
                          {u.name?.split(" ").map((n) => n[0]).join("").slice(0, 2) ?? "U"}
                        </div>
                        <div>
                          <p className="font-medium text-slate-800">{u.name}</p>
                          <p className="text-xs text-slate-400">{u.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2">
                        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${u.role === "admin" ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-600"}`}>
                          {u.role === "admin" ? "Administrador" : "Usuario"}
                        </span>
                        {!u.active && (
                          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-red-50 text-red-600">
                            Bloqueado
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-4 text-slate-500">
                      {new Date(u.createdAt).toLocaleDateString("es-CO")}
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => openEdit(u)}
                          title="Editar usuario"
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-white bg-[#3ab54a] hover:bg-[#289337] rounded-lg transition-colors"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
                          </svg>
                          Editar
                        </button>
                        <button
                          onClick={() => openPwd(u)}
                          title="Cambiar contraseña"
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-white bg-[#3ab54a] hover:bg-[#289337] rounded-lg transition-colors"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z" />
                          </svg>
                          Contraseña
                        </button>
                        <button
                          onClick={() => toggleActive(u)}
                          disabled={togglingId === u.id}
                          title={u.active ? "Bloquear usuario" : "Desbloquear usuario"}
                          className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg transition-colors disabled:opacity-50 ${u.active ? "text-red-600 bg-red-50 hover:bg-red-100" : "text-emerald-600 bg-emerald-50 hover:bg-emerald-100"}`}
                        >
                          {u.active ? (
                            <>
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                              </svg>
                              Bloquear
                            </>
                          ) : (
                            <>
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              Activar
                            </>
                          )}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {users.length === 0 && (
              <div className="text-center py-12 text-slate-400 text-sm">No hay usuarios registrados aún.</div>
            )}
          </div>
        )}
      </div>

      {/* ── Modal crear/editar usuario ── */}
      {userModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={closeUserModal} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-5">
            <h2 className="text-base font-semibold text-slate-800">
              {userModal.mode === "create" ? "Nuevo usuario" : "Editar usuario"}
            </h2>

            <form onSubmit={handleUserSubmit} className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-600">Nombre completo</label>
                <input
                  ref={nameRef}
                  type="text"
                  value={userModal.name}
                  onChange={(e) => setUserModal((s) => ({ ...s, name: e.target.value }))}
                  placeholder="Ej: Juan Pérez"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-600">Email</label>
                <input
                  type="email"
                  value={userModal.email}
                  onChange={(e) => setUserModal((s) => ({ ...s, email: e.target.value }))}
                  placeholder="correo@empresa.com"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                  required
                />
              </div>

              {userModal.mode === "create" && (
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-600">Contraseña</label>
                  <input
                    type="password"
                    value={userModal.password}
                    onChange={(e) => setUserModal((s) => ({ ...s, password: e.target.value }))}
                    placeholder="Mínimo 8 caracteres"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                    required
                  />
                </div>
              )}

              <div className="space-y-1">
                <label className="text-xs font-medium text-slate-600">Rol</label>
                <select
                  value={userModal.role}
                  onChange={(e) => setUserModal((s) => ({ ...s, role: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
                >
                  <option value="user">Usuario</option>
                  <option value="admin">Administrador</option>
                </select>
              </div>

              {userModalError && (
                <p className="text-xs text-red-500">{userModalError}</p>
              )}

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={closeUserModal}
                  className="flex-1 px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={userModalLoading}
                  className="flex-1 px-4 py-2 text-sm font-medium text-white bg-[#f89520] hover:bg-[#e07208] disabled:opacity-60 rounded-lg transition-colors"
                >
                  {userModalLoading ? "Guardando..." : userModal.mode === "create" ? "Crear" : "Guardar"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Modal cambiar contraseña ── */}
      {pwdModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={closePwd} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-5">
            <div>
              <h2 className="text-base font-semibold text-slate-800">Cambiar contraseña</h2>
              <p className="text-sm text-slate-500 mt-0.5">{pwdModal.userName}</p>
            </div>

            {pwdSuccess ? (
              <div className="flex items-center gap-2 text-emerald-600 text-sm py-4 justify-center">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Contraseña actualizada
              </div>
            ) : (
              <form onSubmit={handleChangePassword} className="space-y-4">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-600">Nueva contraseña</label>
                  <input
                    ref={pwdRef}
                    type="password"
                    value={pwd}
                    onChange={(e) => setPwd(e.target.value)}
                    placeholder="Mínimo 8 caracteres"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                    required
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-600">Confirmar contraseña</label>
                  <input
                    type="password"
                    value={pwdConfirm}
                    onChange={(e) => setPwdConfirm(e.target.value)}
                    placeholder="Repetir contraseña"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                    required
                  />
                </div>

                {pwdError && <p className="text-xs text-red-500">{pwdError}</p>}

                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={closePwd}
                    className="flex-1 px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={pwdLoading}
                    className="flex-1 px-4 py-2 text-sm font-medium text-white bg-[#f89520] hover:bg-[#e07208] disabled:opacity-60 rounded-lg transition-colors"
                  >
                    {pwdLoading ? "Guardando..." : "Guardar"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
