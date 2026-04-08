import type { User, UserRole } from '@/types';
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
    value: 'FINANCE',
    label: 'Finance',
    description: 'View reports and approve forecasts',
  },
  {
    value: 'VIEWER',
    label: 'Viewer',
    description: 'Read-only access to dashboards and reports',
  },
];

const userSchema = z.object({
  email: z.string().email('Invalid email address'),
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  role: z.enum(['ADMIN', 'PLANNER', 'FINANCE', 'VIEWER']),
});

type UserFormData = z.infer<typeof userSchema>;

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
  const [selectedRole, setSelectedRole] = useState(roles[1]);

  // Fetch users
  const { data: users, isLoading } = useQuery({
    queryKey: ['users', search],
    queryFn: () => userService.searchUsers({ search: search || undefined }),
  });

  // Create/Invite user mutation
  const createMutation = useMutation({
    mutationFn: (data: UserFormData) => userService.invite(data),
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
    mutationFn: ({ id, data }: { id: string; data: Partial<UserFormData> }) => userService.update(id, data),
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
      role: 'PLANNER',
    },
  });

  const handleOpenModal = (user?: User) => {
    if (user) {
      setEditingUser(user);
      reset({
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
      });
      setSelectedRole(roles.find((r) => r.value === user.role) || roles[1]);
    } else {
      setEditingUser(null);
      reset({
        email: '',
        firstName: '',
        lastName: '',
        role: 'PLANNER',
      });
      setSelectedRole(roles[1]);
    }
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingUser(null);
    reset();
  };

  const onSubmit = (data: UserFormData) => {
    const submitData = {
      ...data,
      role: selectedRole.value,
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
      case 'FINANCE':
        return 'badge-success';
      case 'VIEWER':
        return 'badge-secondary';
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
        {roles.map((role) => {
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
                        {user.role}
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
                      <label className="label">Role</label>
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
                              {roles.map((role) => (
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
                    </div>

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
