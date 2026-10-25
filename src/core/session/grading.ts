import type { AnswerResult, Grade, TaskType } from '../types';

/**
 * Wie eine Antwort in die Planung einfliesst. Die Regel ist bewusst einfach und steht so
 * auch in der App («So funktioniert das Wiederholen»):
 *
 * - Abruf (Schreiben, Karteikarte mit Selbstbewertung): richtig → Gut, mit Toleranz →
 *   Schwierig, falsch → Wiederholen. Bei Karteikarten zählt die eigene Bewertung.
 * - Wiedererkennung (Multiple Choice, Wahr/Falsch, Zuordnen): falsch → Wiederholen,
 *   richtig → keine Änderung. Erkennen ist leichter als Abrufen und soll das Intervall
 *   nicht verlängern.
 */
export function gradeFor(task: TaskType, result: AnswerResult, selfGrade?: Grade): Grade | null {
  if (result === 'skipped') return null;
  if (task === 'flashcard') return selfGrade ?? (result === 'wrong' ? 1 : 3);
  if (task === 'write') {
    if (result === 'correct') return 3;
    if (result === 'almost') return 2;
    return 1;
  }
  return result === 'wrong' ? 1 : null;
}

export function isRecall(task: TaskType): boolean {
  return task === 'write' || task === 'flashcard';
}
