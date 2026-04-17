import { isSuperAdmin } from '@/permissions';
import type { TenantRole, User, UserRole } from '@/types';
import { Dialog, Listbox, Transition } from '@headlessui/react';
import {
    ArrowPathIcon,
    CheckIcon,
    ChevronUpDownIcon,
    ClockIcon,
    EnvelopeIcon,
    MagnifyingGlassIcon,
    PencilIcon,
    PlusIcon,
    ShieldCheckIcon,
    TrashIcon,
    UserCircleIcon,
} from '@heroicons/react/24/outline';
import { zodResolver } from '@hookform/resolvers/zod';
import { userService } from '@services/api';
import { rolesService } from '@services/api/roles.service';
import { useAuthStore } from '@stores/auth.store';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { format } from 'date-fns';
import { Fragment, useState } from 'react';
import { useForm } from 'react-hook-form';
import toast from 'react-hot-toast';
import { z } from 'zod';

const roles: { value: UserRole; label: string; description: string }[] = [
  {
    value: 'SUPER_ADMIN',
    label: 'Super Admin',
    description: 'Platform-level admin — manages all tenants and modules',
  },
  {
    value: 'ADMIN',
    label: 'Admin',
    description: 'Full access to all features and settings',
  },
  {
    value: 'PLANNER',
    label: 'Planner',
    description: 'Create and manage plans and forecasts',
  },
  {
    value: 'FORECAST_PLANNER',
    label: 'Forecast Planner',
    description: 'Planning, forecast, and data access without manufacturing navigation',
  },
  {
    value: 'FINANCE',
    label: 'Finance',
    description: 'View reports and approve forecasts',
  },
  {
    value: 'VIEWER',
    label: 'Viewer',
    description: 'Read-only access to dashboards and reports',
  },
  {
    value: 'FORECAST_VIEWER',
    label: 'Forecast Viewer',
    description: 'Forecast-only read access with a reduced navigation footprint',
  },
];

const adminRole = roles.find((role) => role.value === 'ADMIN')!;
const superAdminRole = roles.find((role) => role.value === 'SUPER_ADMIN')!;

const userSchema = z.object({
  email: z.string().email('Invalid email address'),
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
});

type UserFormData = z.infer<typeof userSchema>;
type UserMutationPayload = UserFormData & {
  role: UserRole;
  customRoleId?: string | null;
};

export default function Users() {
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuthStore();
  const getErrorMessage = (error: unknown, fallback: string) => {
    if (error && typeof error === 'object') {
      const maybeResponse = error as { response?: { data?: { message?: string } } };
      return maybeResponse.response?.data?.message || fallback;
    }
    return fallback;
  };
  const [search, setSearch] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [selectedRole, setSelectedRole] = useState(adminRole);
  const [selectedCustomRole, setSelectedCustomRole] = useState<TenantRole | null>(null);
  const [customRoleTouched, setCustomRoleTouched] = useState(false);

  // Only the admin system role is tenant-assignable. Super admins can still assign the platform role.
  const visibleRoles = isSuperAdmin(currentUser?.role)
    ? roles.filter((role) => role.value === 'SUPER_ADMIN' || role.value === 'ADMIN')
    : roles.filter((role) => role.value === 'ADMIN');

  // Fetch tenant roles for the custom role picker
  const { data: tenantRolesData } = useQuery({
    queryKey: ['roles'],
    queryFn: () => rolesService.listRoles(),
  });
  const tenantRoles = tenantRolesData?.data ?? [];

  // Fetch users
  const { data: users, isLoading } = useQuery({
    queryKey: ['users', search],
    queryFn: () => userService.searchUsers({ search: search || undefined }),
  });

  // Create/Invite user mutation
  const createMutation = useMutation({
    mutationFn: (data: UserMutationPayload) => userService.invite(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success('User invited successfully');
      handleCloseModal();
    },
    onError: (error: unknown) => {
      toast.error(getErrorMessage(error, 'Failed to invite user'));
    },
  });

  // Update user mutation
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<UserMutationPayload> }) => userService.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success('User updated successfully');
      handleCloseModal();
    },
    onError: () => {
      toast.error('Failed to update user');
    },
  });

  // Delete user mutation
  const deleteMutation = useMutation({
    mutationFn: (id: string) => userService.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success('User removed successfully');
    },
    onError: () => {
      toast.error('Failed to remove user');
    },
  });

  // Resend invite mutation
  const resendInviteMutation = useMutation({
    mutationFn: (id: string) => userService.resendInvite(id),
    onSuccess: () => {
      toast.success('Invite resent successfully');
    },
    onError: () => {
      toast.error('Failed to resend invite');
    },
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<UserFormData>({
    resolver: zodResolver(userSchema),
    defaultValues: {
      email: '',
      firstName: '',
      lastName: '',
    },
  });

  const handleOpenModal = (user?: User) => {
    if (user) {
      setEditingUser(user);
      reset({
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
      });
      setSelectedRole(
        user.role === 'SUPER_ADMIN' && isSuperAdmin(currentUser?.role)
          ? superAdminRole
          : adminRole,
      );
      setSelectedCustomRole(
        user.roleId ? tenantRoles.find((tenantRole) => tenantRole.id === user.roleId) ?? null : null,
      );
    } else {
      setEditingUser(null);
      reset({
        email: '',
        firstName: '',
        lastName: '',
      });
      setSelectedRole(adminRole);
      setSelectedCustomRole(null);
    }
    setCustomRoleTouched(false);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingUser(null);
    setSelectedRole(adminRole);
    setSelectedCustomRole(null);
    setCustomRoleTouched(false);
    reset({
      email: '',
      firstName: '',
      lastName: '',
    });
  };

  const onSubmit = (data: UserFormData) => {
    const preserveHiddenLegacyRole =
      !!editingUser &&
      editingUser.role !== 'ADMIN' &&
      editingUser.role !== 'SUPER_ADMIN';

    const submitData: UserMutationPayload = {
      ...data,
      role: preserveHiddenLegacyRole ? editingUser.role : selectedRole.value,
      ...(editingUser
        ? customRoleTouched
          ? { customRoleId: selectedCustomRole?.id ?? null }
          : {}
        : selectedCustomRole
          ? { customRoleId: selectedCustomRole.id }
          : {}),
    };

    if (editingUser) {
      updateMutation.mutate({ id: editingUser.id, data: submitData });
    } else {
      createMutation.mutate(submitData);
    }
  };

  const handleDelete = (user: User) => {
    if (user.id === currentUser?.id) {
      toast.error("You can't remove yourself");
      return;
    }
    if (confirm(`Are you sure you want to remove "${user.firstName} ${user.lastName}"?`)) {
      deleteMutation.mutate(user.id);
    }
  };

  const getRoleBadgeColor = (role: UserRole) => {
    switch (role) {
      case 'ADMIN':
        return 'badge-error';
      case 'PLANNER':
        return 'badge-primary';
      case 'FORECAST_PLANNER':
        return 'badge-warning';
      case 'FINANCE':
        return 'badge-success';
      case 'VIEWER':
        return 'badge-secondary';
      case 'FORECAST_VIEWER':
        return 'badge-primary';
      default:
        return 'badge-secondary';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">User Management</h1>
          <p className="text-secondary-500 mt-1">
            Invite and manage team members
          </p>
        </div>
        <button className="btn-primary" onClick={() => handleOpenModal()}>
          <PlusIcon className="w-5 h-5 mr-2" />
          Invite User
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {visibleRoles.map((role) => {
          const count = users?.filter((u) => u.role === role.value).length || 0;
          return (
            <div key={role.value} className="card p-4">
              <p className="text-sm text-secondary-500">{role.label}s</p>
              <p className="text-2xl font-bold">{count}</p>
            </div>
          );
        })}
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-secondary-400" />
        <input
          type="text"
          placeholder="Search users..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input pl-10 w-full"
        />
      </div>

      {/* Users List */}
      <div className="card">
        {isLoading ? (
          <div className="p-12 flex justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary-500" />
          </div>
        ) : !users || users.length === 0 ? (
          <div className="p-12 text-center">
            <UserCircleIcon className="w-12 h-12 text-secondary-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium">No users found</h3>
            <p className="text-secondary-500 mt-1">
              Invite your first team member to get started.
            </p>
            <button
              className="btn-primary mt-4"
              onClick={() => handleOpenModal()}
            >
              <PlusIcon className="w-5 h-5 mr-2" />
              Invite User
            </button>
          </div>
        ) : (
          <div className="divide-y divide-secondary-200 dark:divide-secondary-700">
            {users.map((user) => (
              <div
                key={user.id}
                className="p-4 flex items-center justify-between hover:bg-secondary-50 dark:hover:bg-secondary-800/50"
              >
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center">
                    <span className="text-sm font-medium text-primary-600">
                      {user.firstName[0]}
                      {user.lastName[0]}
                    </span>
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">
                        {user.firstName} {user.lastName}
                      </span>
                      {user.id === currentUser?.id && (
                        <span className="text-xs text-secondary-500">(You)</span>
                      )}
                      <span className={clsx('badge', getRoleBadgeColor(user.role))}>
                        {roles.find((roleOption) => roleOption.value === user.role)?.label || user.role}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 text-sm text-secondary-500">
                      <span className="flex items-center gap-1">
                        <EnvelopeIcon className="w-4 h-4" />
                        {user.email}
                      </span>
                      {user.lastLoginAt && (
                        <span className="flex items-center gap-1">
                          <ClockIcon className="w-4 h-4" />
                          Last login: {format(new Date(user.lastLoginAt), 'MMM d, yyyy')}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {!user.lastLoginAt && (
                    <button
                      onClick={() => resendInviteMutation.mutate(user.id)}
                      disabled={resendInviteMutation.isPending}
                      className="p-2 hover:bg-secondary-100 dark:hover:bg-secondary-700 rounded-lg transition-colors"
                      title="Resend invite"
                    >
                      <ArrowPathIcon className="w-5 h-5 text-secondary-500" />
                    </button>
                  )}
                  <button
                    onClick={() => handleOpenModal(user)}
                    className="p-2 hover:bg-secondary-100 dark:hover:bg-secondary-700 rounded-lg transition-colors"
                  >
                    <PencilIcon className="w-5 h-5 text-secondary-500" />
                  </button>
                  {user.id !== currentUser?.id && (
                    <button
                      onClick={() => handleDelete(user)}
                      className="p-2 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-lg transition-colors"
                    >
                      <TrashIcon className="w-5 h-5 text-red-500" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Invite/Edit Modal */}
      <Transition appear show={isModalOpen} as={Fragment}>
        <Dialog as="div" className="relative z-50" onClose={handleCloseModal}>
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-300"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-200"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-black/25 backdrop-blur-sm" />
          </Transition.Child>

          <div className="fixed inset-0 overflow-y-auto">
            <div className="flex min-h-full items-center justify-center p-4">
              <Transition.Child
                as={Fragment}
                enter="ease-out duration-300"
                enterFrom="opacity-0 scale-95"
                enterTo="opacity-100 scale-100"
                leave="ease-in duration-200"
                leaveFrom="opacity-100 scale-100"
                leaveTo="opacity-0 scale-95"
              >
                <Dialog.Panel className="w-full max-w-md transform overflow-hidden rounded-2xl bg-white dark:bg-secondary-800 p-6 shadow-xl transition-all">
                  <Dialog.Title as="h3" className="text-lg font-semibold mb-4">
                    {editingUser ? 'Edit User' : 'Invite New User'}
                  </Dialog.Title>

                  <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                    <div>
                      <label className="label">Email Address</label>
                      <input
                        type="email"
                        {...register('email')}
                        className="input w-full"
                        placeholder="name@company.com"
                        disabled={!!editingUser}
                      />
                      {errors.email && (
                        <p className="text-sm text-red-500 mt-1">
                          {errors.email.message}
                        </p>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="label">First Name</label>
                        <input
                          type="text"
                          {...register('firstName')}
                          className="input w-full"
                          placeholder="John"
                        />
                        {errors.firstName && (
                          <p className="text-sm text-red-500 mt-1">
                            {errors.firstName.message}
                          </p>
                        )}
                      </div>
                      <div>
                        <label className="label">Last Name</label>
                        <input
                          type="text"
                          {...register('lastName')}
                          className="input w-full"
                          placeholder="Doe"
                        />
                        {errors.lastName && (
                          <p className="text-sm text-red-500 mt-1">
                            {errors.lastName.message}
                          </p>
                        )}
                      </div>
                    </div>

                    <div>
                      <label className="label">System Role</label>
                      <p className="text-xs text-secondary-500 mb-2">
                        Non-admin access should be assigned through a permission role. Tenant users keep the admin system role.
                      </p>
                      {visibleRoles.length === 1 ? (
                        <div className="input w-full flex items-center gap-2 text-left">
                          <ShieldCheckIcon className="w-5 h-5 text-secondary-400" />
                          <span>{selectedRole.label}</span>
                        </div>
                      ) : (
                        <Listbox value={selectedRole} onChange={setSelectedRole}>
                          <div className="relative">
                            <Listbox.Button className="input w-full text-left flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <ShieldCheckIcon className="w-5 h-5 text-secondary-400" />
                                <span>{selectedRole.label}</span>
                              </div>
                              <ChevronUpDownIcon className="w-5 h-5 text-secondary-400" />
                            </Listbox.Button>
                            <Transition
                              as={Fragment}
                              leave="transition ease-in duration-100"
                              leaveFrom="opacity-100"
                              leaveTo="opacity-0"
                            >
                              <Listbox.Options className="absolute z-10 mt-1 w-full bg-white dark:bg-secondary-700 rounded-lg shadow-lg border border-secondary-200 dark:border-secondary-600 max-h-60 overflow-auto">
                                {visibleRoles.map((role) => (
                                  <Listbox.Option
                                    key={role.value}
                                    value={role}
                                    className={({ active }) =>
                                      clsx(
                                        'px-4 py-3 cursor-pointer',
                                        active &&
                                          'bg-primary-50 dark:bg-primary-900/30',
                                      )
                                    }
                                  >
                                    {({ selected }) => (
                                      <div className="flex items-center justify-between">
                                        <div>
                                          <p className="font-medium">{role.label}</p>
                                          <p className="text-sm text-secondary-500">
                                            {role.description}
                                          </p>
                                        </div>
                                        {selected && (
                                          <CheckIcon className="w-5 h-5 text-primary-500" />
                                        )}
                                      </div>
                                    )}
                                  </Listbox.Option>
                                ))}
                              </Listbox.Options>
                            </Transition>
                          </div>
                        </Listbox>
                      )}
                    </div>

                    {/* Dynamic role assignment for tenant-level RBAC */}
                    {tenantRoles.length > 0 && (
                      <div>
                        <label className="block text-sm font-medium text-secondary-700 dark:text-secondary-300 mb-1">
                          Permission Role <span className="text-xs text-secondary-400">(optional)</span>
                        </label>
                        <p className="text-xs text-secondary-500 mb-2">
                          Use a tenant permission role for non-admin access. Leave this empty to keep full admin permissions.
                        </p>
                        <Listbox
                          value={selectedCustomRole}
                          onChange={(role) => {
                            setSelectedCustomRole(role);
                            setCustomRoleTouched(true);
                          }}
                        >
                          <div className="relative">
                            <Listbox.Button className="input w-full text-left flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <ShieldCheckIcon className="w-5 h-5 text-secondary-400" />
                                <span>{selectedCustomRole?.name ?? 'Use default admin permissions'}</span>
                              </div>
                              <ChevronUpDownIcon className="w-5 h-5 text-secondary-400" />
                            </Listbox.Button>
                            <Transition
                              as={Fragment}
                              leave="transition ease-in duration-100"
                              leaveFrom="opacity-100"
                              leaveTo="opacity-0"
                            >
                              <Listbox.Options className="absolute z-10 mt-1 w-full bg-white dark:bg-secondary-700 rounded-lg shadow-lg border border-secondary-200 dark:border-secondary-600 max-h-60 overflow-auto">
                                <Listbox.Option
                                  value={null}
                                  className={({ active }) =>
                                    clsx('px-4 py-3 cursor-pointer', active && 'bg-primary-50 dark:bg-primary-900/30')
                                  }
                                >
                                  {({ selected }) => (
                                    <div className="flex items-center justify-between">
                                      <p className="font-medium text-secondary-500">Use default admin permissions</p>
                                      {selected && <CheckIcon className="w-5 h-5 text-primary-500" />}
                                    </div>
                                  )}
                                </Listbox.Option>
                                {tenantRoles.map((tr) => (
                                  <Listbox.Option
                                    key={tr.id}
                                    value={tr}
                                    className={({ active }) =>
                                      clsx('px-4 py-3 cursor-pointer', active && 'bg-primary-50 dark:bg-primary-900/30')
                                    }
                                  >
                                    {({ selected }) => (
                                      <div className="flex items-center justify-between">
                                        <div>
                                          <p className="font-medium">{tr.name}</p>
                                          <p className="text-sm text-secondary-500">{tr.description}</p>
                                        </div>
                                        {selected && <CheckIcon className="w-5 h-5 text-primary-500" />}
                                      </div>
                                    )}
                                  </Listbox.Option>
                                ))}
                              </Listbox.Options>
                            </Transition>
                          </div>
                        </Listbox>
                      </div>
                    )}

                    <div className="flex justify-end gap-3 pt-4">
                      <button
                        type="button"
                        onClick={handleCloseModal}
                        className="btn-secondary"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={createMutation.isPending || updateMutation.isPending}
                        className="btn-primary"
                      >
                        {createMutation.isPending || updateMutation.isPending
                          ? 'Saving...'
                          : editingUser
                            ? 'Update User'
                            : 'Send Invite'}
                      </button>
                    </div>
                  </form>
                </Dialog.Panel>
              </Transition.Child>
            </div>
          </div>
        </Dialog>
      </Transition>
    </div>
  );
}
