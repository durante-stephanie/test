import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http'; // Violation: Direct HttpClient usage

@Component({
  selector: 'app-test-violation',
  standalone: true,
  imports: [CommonModule],
  template: `
    <!-- Violation: Using *ngIf instead of @if -->
    <div *ngIf="isVisible">
      <!-- Violation: Using ngStyle instead of ngClass -->
      <p [ngStyle]="{'color': 'red', 'font-weight': 'bold'}">This is a test paragraph.</p>
    </div>

    <!-- Violation: Using *ngFor instead of @for -->
    <ul>
      <li *ngFor="let item of items">{{ item }}</li>
    </ul>

    <button (click)="doSomething()">Click Me</button>
  `,
  // Violation: ::ng-deep without :host wrapper
  styles: [`
    ::ng-deep .custom-class {
      background-color: yellow;
    }
  `]
})
export class TestViolationComponent {
  // Violation: Using 'any' type
  data: any;
  isVisible = true;
  items = ['Item 1', 'Item 2', 'Item 3'];

  // Violation: Direct HttpClient injection in component
  constructor(private http: HttpClient) {}

  // Violation: Line exceeds 80 characters
  doSomething() {
    this.data = "Some very long string that is definitely going to exceed the eighty character limit set in the editor configuration to test if the linter catches it properly.";
    
    // Violation: Nested subscription
    this.http.get('https://api.example.com/data')
      .subscribe((response: any) => {
      this.http.get('https://api.example.com/details/' + response.id).subscribe((details) => {
        console.log(details);
      });
    });
  }
}