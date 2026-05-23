import { z } from 'zod';

export const LoginSchema = z.object({
  email: z.string().email('Enter a valid email').toLowerCase().trim(),
  password: z.string().min(1, 'Password is required'),
});
export type LoginInput = z.infer<typeof LoginSchema>;

export const RegisterSchema = z.object({
  name: z.string().min(1, 'Name is required').max(60),
  email: z.string().email('Enter a valid email').toLowerCase().trim(),
  password: z.string().min(6, 'At least 6 characters'),
});
export type RegisterInput = z.infer<typeof RegisterSchema>;

export type Gender = 'male' | 'female' | 'other';
export type EmploymentType = 'full-time' | 'part-time' | 'contract';

export interface AuthUser {
  id: string;
  _id?: string;
  email: string;
  name: string;
  /** Role keys are dynamic — `admin` plus any custom role created at /users. */
  role: string;
  blocked?: boolean;
  avatar?: string;
  accent: string;
  theme: 'dark' | 'light';
  density: 'comfy' | 'compact';
  gender?: Gender | null;
  dateOfBirth?: string | null;
  nationality?: string | null;
  jobTitle?: string | null;
  department?: string | null;
  employmentType?: EmploymentType | null;
  twoFactorEnabled?: boolean;
}

export interface AuthResponse {
  accessToken: string;
  user: AuthUser;
}
