// Shared by the notifications page and the bell in the top bar: the icon of
// each notification type and where a click on it should go.

import {
  AlertCircle,
  AlertTriangle,
  ArrowRightLeft,
  AtSign,
  Bell,
  CalendarClock,
  CheckCircle2,
  Clock,
  FileCheck,
  ListPlus,
  MessageSquare,
  Paperclip,
  Pencil,
  Rocket,
  RotateCcw,
  ShieldCheck,
  ShieldQuestion,
  ShieldX,
  Trophy,
  UserPlus,
} from "lucide-react";
import type { Notification } from "@/types";

export const TYPE_ICON: Record<Notification["type"], typeof Bell> = {
  conversation_assigned: UserPlus,
  contract_signed: FileCheck,
  task_assigned: UserPlus,
  task_reassigned: UserPlus,
  task_participant_added: UserPlus,
  task_moved: ArrowRightLeft,
  task_transferred: ArrowRightLeft,
  task_completed: CheckCircle2,
  task_reopened: RotateCcw,
  task_urgent: AlertTriangle,
  subtask_created: ListPlus,
  subtask_completed: CheckCircle2,
  due_date_set: CalendarClock,
  due_date_changed: CalendarClock,
  due_date_approaching: Clock,
  task_overdue: AlertCircle,
  task_comment: MessageSquare,
  task_mention: AtSign,
  comment_reply: MessageSquare,
  task_file_added: Paperclip,
  approval_requested: ShieldQuestion,
  approval_approved: ShieldCheck,
  approval_rejected: ShieldX,
  deal_won: Trophy,
  kickoff_task_created: Rocket,
  task_updated: Pencil,
};

/** Where clicking a notification leads (null: nothing to open). */
export function notificationHref(n: Notification): string | null {
  if (n.conversation_id) return `/inbox?c=${n.conversation_id}`;
  if (n.deal_id) return `/pipelines/deals/${n.deal_id}`;
  if (n.board_id && n.task_id) return `/operational/boards/${n.board_id}?task=${n.task_id}`;
  return null;
}

/** The full list lives in the same environment the person is working in. */
export function notificationsListHref(pathname: string): string {
  return pathname.startsWith("/operational") ? "/operational/notificacoes" : "/notifications";
}
