import { Component, Injectable, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { switchMap } from 'rxjs/operators';
import { Observable } from 'rxjs';

// Guideline: Use Pascal case for type aliases[cite: 62].
// Guideline: Always use type keyword to structure an object instead of interface[cite: 51].
export type DataResponse = {
  id: number;
  content: string;
};

// FIX: Added a specific type model for the details response to avoid 'any'.
export type DetailsResponse = {
  id: number;
  details: string;
  timestamp: string;
};

@Injectable({
  providedIn: 'root'
})
export class DataService {
  private http = inject(HttpClient);

  getData(): Observable<DataResponse> {
    // Guideline: Always create a model to structure HTTP response.
    return this.http.get<DataResponse>('https://api.example.com/data');
  }

  // FIX: Replaced Observable<any> with Observable<DetailsResponse>.
  getDetails(id: number): Observable<DetailsResponse> {
    return this.http.get<DetailsResponse>
    (`https://api.example.com/details/${id}`);
  }
}

@Component({
  selector: 'app-test-violation',
  standalone: true,
  imports: [CommonModule],
  template: `
    @if (isVisible) {
      <div>
        <p class="highlight-text">This is a test paragraph.</p>
      </div>
    }

    <ul>
      @for (item of items; track item) {
        <li>{{ item }}</li>
      }
    </ul>

    <button (click)="doSomething()">Click Me</button>
  `,
  styles: [`
    /* Guideline: Include ::ng-deep in a parent container like :host[cite: 81]. */
    :host {
      ::ng-deep .custom-class {
        background-color: yellow;
      }
    }

    .highlight-text {
      color: red;
      font-weight: bold;
    }
  `]
})
export class TestViolationComponent {
  // Guideline: Take advantage of TS inference type for primitives[cite: 116].
  isVisible = true;
  items = ['Item 1', 'Item 2', 'Item 3'];

  // Guideline: Group similar structures (private properties/injects)[cite: 78].
  private dataService = inject(DataService); 
  
  // Guideline: Never use the any type.
  data: string | undefined;

  doSomething() {
    // Guideline: Add double tab indentation for split lines[cite: 162].
    this.data = 'Some very long string that is definitely going to exceed the' +
        'eighty character limit set in the editor configuration to test if ' +
        'the linter catches it properly.';

    // Guideline: Do not create observable inside a subscription (nesting)[cite: 219].
    // Guideline: Use pipe() and RXJS operators[cite: 220].
    this.dataService.getData().pipe(
      switchMap((response) => this.dataService.getDetails(response.id))
    ).subscribe((details) => {
      console.log(details);
    });
  }
}