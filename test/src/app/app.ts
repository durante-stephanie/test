import { Component, Injectable, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { switchMap, tap } from 'rxjs/operators';
import { Observable } from 'rxjs';

// Define strict types to avoid 'any'
export type DataResponse = {
  id: number;
  content: string;
};

export type DetailsResponse = {
  id: number;
  details: string;
  timestamp: string;
};

// 1. Move HTTP logic to a Service (Fixes: Direct HttpClient usage)
@Injectable({
  providedIn: 'root',
})
export class DataService {
  private http = inject(HttpClient);

  getData(): Observable<DataResponse> {
    // Guideline: Always create a model to structure HTTP response
    return this.http.get<DataResponse>('https://api.example.com/data');
  }

  getDetails(id: number): Observable<DetailsResponse> {
    return this.http.get<DetailsResponse>(
      `https://api.example.com/details/${id}`
    );
  }
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule],
  // 2. Use @if and @for (Fixes: *ngIf, *ngFor violations)
  // 3. Use class binding instead of ngStyle (Fixes: ngStyle violation)
  template: `
    @if (isVisible()) {
      <div>
        <p class="highlight-text">This is a test paragraph.</p>
      </div>
    }

    <ul>
      @for (item of items(); track item) {
        <li>{{ item }}</li>
      }
    </ul>

    <button (click)="doSomething()">Click Me</button>
  `,
  // 4. Wrap ::ng-deep in :host (Fixes: Encapsulation violation)
  styles: [
    `
    :host {
      ::ng-deep .custom-class {
        background-color: yellow;
      }
    }

    .highlight-text {
      color: red;
      font-weight: bold;
    }
  `,
  ],
})
export class App {
  // 5. Use Signals/Inference (Fixes: Primitive type inference)
  protected isVisible = signal(true);
  protected items = signal(['Item 1', 'Item 2', 'Item 3']);
  
  // 6. Use specific type instead of any (Fixes: 'any' type violation)
  protected data: string | undefined;

  // 7. Inject Service (Fixes: Direct HttpClient violation)
  private dataService = inject(DataService);

  doSomething() {
    // 8. Fix Line Length (Fixes: >80 chars violation)
    // Split the string into multiple lines to stay under 80 chars
    const part1 = 'Some very long string that is definitely going to exceed ';
    const part2 = 'the eighty character limit set in the editor configuration ';
    const part3 = 'to test if the linter catches it properly.';
    this.data = part1 + part2 + part3;

    // 9. Fix Nested Subscription (Fixes: Nested subscription violation)
    // Use switchMap to chain requests instead of subscribing inside a subscribe
    this.dataService
      .getData()
      .pipe(
        switchMap((response) => this.dataService.getDetails(response.id)),
        tap((details) => console.log(details))
      )
      .subscribe();
  }
}