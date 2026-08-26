# Demo PR body

Copy this into a pull request after DemoShop is available on GitHub Pages.

````markdown
## Summary

Verify the DemoShop coupon and synthetic checkout flow.

```yaml
spec2proof:
  target:
    environment: demo
    base_url: https://pxf77.github.io/Spec2Proof/
  criteria:
    - id: AC-001
      description: SAVE20 reduces the order total from 100.00 to 80.00
      preconditions:
        - DemoShop is open
      automation_class: AUTO
      expected:
        - type: text
          selector: '[data-testid="coupon-message"]'
          value: Discount applied
          mode: exact
        - type: text
          selector: '[data-testid="order-total"]'
          value: "80.00"
          mode: exact

    - id: AC-002
      description: EXPIRED20 is rejected and leaves the order total unchanged
      preconditions:
        - DemoShop is open
      automation_class: AUTO
      expected:
        - type: text
          selector: '[data-testid="coupon-message"]'
          value: Coupon expired
          mode: exact
        - type: text
          selector: '[data-testid="order-total"]'
          value: "100.00"
          mode: exact

    - id: AC-003
      description: Placing the synthetic order reaches the order success route
      preconditions:
        - SAVE20 has been applied
      automation_class: AUTO
      expected:
        - type: url
          matches: "#/order/success$"
          mode: regex
        - type: text
          selector: '[data-testid="success-panel"] h2'
          value: Order confirmed
          mode: exact
```

## Risk

- [x] Non-production target
- [x] Synthetic data only
- [x] No real payment, email, SMS, or destructive operation
````
