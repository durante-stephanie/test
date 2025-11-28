import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';

@Component({
  selector: 'app-test-violation',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div *ngIf="isVisible">
      <p [ngStyle]="{'color': 'red', 'font-weight': 'bold'}">This is a test paragraph.</p>
    </div>

    <ul>
      <li *ngFor="let item of items">{{ item }}</li>
    </ul>

    <button (click)="doSomething()">Click Me</button>
  `,
  styles: [`
    ::ng-deep .custom-class {
      background-color: yellow;
    }
  `]
})
export class TestViolationComponent {
  data: any;
  isVisible = true;
  items = ['Item 1', 'Item 2', 'Item 3'];

  constructor(private http: HttpClient) {}

  doSomething() {
    this.data = "Some very long string that is definitely going to exceed the eighty character limit set in the editor configuration to test if the linter catches it properly.";
    
    this.http.get('https://api.example.com/data').subscribe((response: any) => {
      this.http.get('https://api.example.com/details/' + response.id).subscribe((details) => {
        console.log(details);
      });
    });
  }
}