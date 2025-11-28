import { Component, Injectable, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { switchMap } from 'rxjs/operators';
import { Observable } from 'rxjs';

// [cite: 51] Always use type keyword to structure an object instead of interface.
// [cite: 62] Use Pascal case for type aliases.
export type DataResponse = {
  id: number;
  content: string;
};

//  Create a service to implement HTTP requests. Do not use HttpClient directly in component.
@Injectable({
  providedIn: 'root'
})
export class DataService {
  private http = inject(HttpClient);

  getData(): Observable<DataResponse> {
    // [cite: 206] Always create a model to structure HTTP response. (Using DataResponse)
    return this.http.get<DataResponse>('https://api.example.com/data');
  }

  getDetails(id: number): Observable<any> {
    return this.http.get(`https://api.example.com/details/${id}`);
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
    /*  When using ::ng-deep, include it in a parent container such as :host */
    :host {
      ::ng-deep .custom-class {
        background-color: yellow;
      }
    }

    /* Moved from ngStyle to CSS class per  */
    .highlight-text {
      color: red;
      font-weight: bold;
    }
  `]
})
export class TestViolationComponent {
  //  Take advantage of TS inference type. Do not specify type for primitive with initial value.
  isVisible = true;
  items = ['Item 1', 'Item 2', 'Item 3'];

  // [cite: 78] Group similar structures (private properties/injects).
  private dataService = inject(DataService); 
  
  // [cite: 57] Never use the any type. 
  // [cite: 121] If declaring object variable from type without value, specify type.
  data: string | undefined;

  doSomething() {
    // [cite: 162] When splitting element to multiple lines, add double tab indentation.
    // Broken into concatenated strings to fix line length violation.
    this.data = 'Some very long string that is definitely going to exceed the ' +
        'eighty character limit set in the editor configuration to test if ' +
        'the linter catches it properly.';

    // [cite: 219] Do not create observable inside a subscription.
    // [cite: 220] Use pipe() and RXJS operators (switchMap) to chain operations.
    this.dataService.getData().pipe(
      switchMap((response) => this.dataService.getDetails(response.id))
    ).subscribe((details) => {
      console.log(details);
    });
  }
}