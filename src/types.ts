export type Reminder = { id: string; title: string; due_date: string; due_time: string | null; note: string | null; is_completed: boolean; created_at: string; updated_at: string }
export type ReminderInput = Pick<Reminder, 'title' | 'due_date' | 'due_time' | 'note'>
