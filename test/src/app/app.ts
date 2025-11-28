import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, CommonModule],
  template: `
    <!-- CORRECT: Using new control flow syntax -->
    @if (isVisible()) {
      <div>Content is visible</div>
    }

    <!-- VIOLATION: Using legacy *ngIf (should be flagged) -->
    <div *ngIf="isVisible()">Legacy content</div>

    <!-- CORRECT: Using new control flow syntax for loop -->
    @for (item of items(); track item.id) {
      <div>{{ item.name }}</div>
    }

    <!-- VIOLATION: Using legacy *ngFor (should be flagged) -->
    <div *ngFor="let item of items()">{{ item.name }}</div>

    <!-- CORRECT: Using new control flow syntax for switch -->
    @switch (role()) {
      @case ('admin') { <p>Welcome Admin</p> }
      @case ('user') { <p>Welcome User</p> }
      @default { <p>Welcome Guest</p> }
    }

    <!-- VIOLATION: Using ngStyle (should be flagged) -->
    <div [ngStyle]="{'color': 'red'}">Styled Text</div>
  `
})
export class App {
  // CORRECT: Using signals
  protected readonly isVisible = signal(true);
  protected readonly items = signal([{id: 1, name: 'Item 1'}, {id: 2, name: 'Item 2'}]);
  protected readonly role = signal('admin');

  // VIOLATION: Explicit 'any' type (should be flagged)
  processData(data: any) {
    console.log(data);
  }
}

