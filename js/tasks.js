// js/tasks.js
import { setupAuthListener } from "./auth.js";

const $ = id => document.getElementById(id);

setupAuthListener((user, isTeacher) => {
  if (user) {
    if (isTeacher) {
      $("tasks-actions-teacher").style.display = "flex";
      loadTeacherTasks();
    } else {
      $("tasks-actions-teacher").style.display = "none";
      loadStudentTasks();
    }
  }
});

function loadTeacherTasks() {
  $("tasks-list").innerHTML = "<p class='text-dim'>Aún no has creado tareas.</p>";
}

function loadStudentTasks() {
  $("tasks-list").innerHTML = "<p class='text-dim'>No tienes misiones pendientes.</p>";
}
