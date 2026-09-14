export type Role = 'user' | 'admin' | 'super_admin';
export type RequestedRole = 'user' | 'admin';
export type MembershipStatus = 'pending' | 'approved' | 'rejected';
export type EquipmentStatus = 'available' | 'maintenance' | 'offline';
export type BookingStatus =
  'pending' | 'approved' | 'in_use' | 'returned' | 'renewed' | 'rejected' | 'cancelled';
export interface Profile {
  id: string;
  name: string;
  email: string;
  student_id: string;
  project: string;
  role: Role;
  membership_status: MembershipStatus;
  banned: boolean;
  suspended_until: string | null;
  violations_count: number;
}
export interface Equipment {
  id: string;
  name: string;
  model: string;
  category: string;
  project: string;
  room: '504' | '505';
  location: string;
  manager_id: string;
  manager_name: string;
  status: EquipmentStatus;
  open_time: string;
  close_time: string;
  weekdays: number[];
  description: string;
  precautions: string;
  image_url: string;
  asset_code: string;
  created_at: string;
}
export interface Booking {
  id: string;
  equipment_id: string;
  user_id: string;
  user_name: string;
  starts_at: string;
  ends_at: string;
  purpose: string;
  status: BookingStatus;
  review_note: string;
  return_note: string;
  returned_at: string | null;
  parent_id: string | null;
  created_at: string;
}
export interface BusySlot {
  equipment_id: string;
  starts_at: string;
  ends_at: string;
  status: BookingStatus;
}
export interface Notice {
  id: string;
  user_id: string;
  title: string;
  body: string;
  read: boolean;
  created_at: string;
}
export interface Violation {
  id: string;
  user_id: string;
  reason: string;
  penalty: string;
  created_at: string;
}
export interface Snapshot {
  equipment: Equipment[];
  bookings: Booking[];
  profiles: Profile[];
  notices: Notice[];
  violations: Violation[];
  busy: BusySlot[];
  applications: MembershipApplication[];
}
export interface MembershipApplication {
  id: string;
  user_id: string;
  name: string;
  email: string;
  student_id: string;
  project: string;
  requested_role: RequestedRole;
  status: MembershipStatus;
  score: number;
  rules_version: string;
  created_at: string;
  reviewed_at: string | null;
  reviewer_name: string | null;
  review_note: string;
}
export interface Question {
  id: number;
  question: string;
  options: string[];
}
export interface AnswerQuestion extends Question {
  answer: number;
  explanation: string;
}
export interface Exam {
  id: string;
  questions: Question[];
}
export interface ExamResult {
  score: number;
  passed: boolean;
  token?: string;
  review?: { question: string; correct: string; explanation: string }[];
}
export interface Registration {
  email: string;
  password: string;
  name: string;
  student_id: string;
  project: string;
  token: string;
  requested_role?: RequestedRole;
}
export interface BookingInput {
  equipment_id: string;
  starts_at: string;
  ends_at: string;
  purpose: string;
  parent_id?: string | null;
}
export interface DataService {
  mode: 'demo' | 'supabase' | 'cloudbase';
  session(): Promise<Profile | null>;
  login(email: string, password: string): Promise<Profile>;
  demoLogin?(role: Role): Promise<Profile>;
  logout(): Promise<void>;
  onSessionInvalidated?(callback: () => void): () => void;
  snapshot(): Promise<Snapshot>;
  startExam(email: string): Promise<Exam>;
  submitExam(id: string, answers: Record<number, number>): Promise<ExamResult>;
  register(input: Registration): Promise<{ needsConfirmation: boolean; needsApproval?: boolean }>;
  reviewMembership(id: string, action: 'approve' | 'reject', note?: string): Promise<void>;
  saveEquipment(input: Partial<Equipment>): Promise<void>;
  uploadImage(file: File): Promise<string>;
  book(input: BookingInput): Promise<void>;
  bookingAction(
    id: string,
    action: 'approve' | 'reject' | 'cancel' | 'checkout' | 'return',
    note?: string,
  ): Promise<void>;
  markRead(): Promise<void>;
  recordViolation(userId: string, reason: string): Promise<void>;
}
