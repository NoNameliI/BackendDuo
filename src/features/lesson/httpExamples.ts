import { courseById } from '@/content/courses';
import type { Lesson } from '@/content/loadCourse';
import { parseRequest, type ApiRequest, type ApiResponse } from '@/engine/api/http';
import { HttpSimServer, sendTo, splitRequests } from '@/engine/api/server';

export interface HttpRun {
  request: ApiRequest;
  response: ApiResponse | null;
  error?: string;
}

// The `http example` blocks of a lesson share one virtual server and run in order, like requests sent by hand.
let server: HttpSimServer | null = null;
let loadedLesson: string | null = null;

function load(lesson: Lesson): HttpSimServer | null {
  const def = lesson.exampleServer ? courseById(lesson.courseId).servers[lesson.exampleServer] : undefined;
  server = def ? new HttpSimServer(def) : null;
  loadedLesson = lesson.id;
  return server;
}

export function runHttpExample(lesson: Lesson, text: string): HttpRun[] {
  const target = loadedLesson === lesson.id ? server : load(lesson);
  return splitRequests(text).map((block) => {
    let request: ApiRequest;
    try {
      request = parseRequest(block);
    } catch (e) {
      return { request: { method: '?', url: '', headers: [], body: '' }, response: null, error: (e as Error).message };
    }
    if (!target) return { request, response: null, error: 'У урока нет учебного сервера' };
    const res = sendTo(target, request);
    return typeof res === 'string' ? { request, response: null, error: res } : { request, response: res };
  });
}

export function resetHttpExamples(lesson: Lesson): void {
  load(lesson);
}
