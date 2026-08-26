const baseTotal = 100;
const parameters = new URLSearchParams(window.location.search);
const fault = parameters.get("fault");

const couponInput = document.querySelector('[data-testid="coupon-input"]');
const applyButton = document.querySelector('[data-testid="apply-coupon"]');
const couponMessage = document.querySelector('[data-testid="coupon-message"]');
const total = document.querySelector('[data-testid="order-total"]');
const checkout = document.querySelector('[data-testid="checkout"]');
const checkoutCard = document.querySelector('[data-testid="checkout-card"]');
const successPanel = document.querySelector('[data-testid="success-panel"]');
const successTotal = document.querySelector('[data-testid="success-total"]');

let currentTotal = baseTotal;

applyButton.addEventListener("click", () => {
  const code = couponInput.value.trim().toUpperCase();
  couponMessage.className = "message";

  if (code === "SAVE20") {
    currentTotal = 80;
    couponMessage.textContent = "Discount applied";
    couponMessage.classList.add("ok");
  } else if (code === "EXPIRED20") {
    if (fault === "expired-coupon") {
      currentTotal = 80;
      couponMessage.textContent = "Discount applied";
      couponMessage.classList.add("ok");
    } else {
      currentTotal = baseTotal;
      couponMessage.textContent = "Coupon expired";
      couponMessage.classList.add("error");
    }
  } else {
    currentTotal = baseTotal;
    couponMessage.textContent = "Coupon not recognized";
    couponMessage.classList.add("error");
  }

  total.textContent = currentTotal.toFixed(2);
});

checkout.addEventListener("click", () => {
  successTotal.textContent = currentTotal.toFixed(2);
  checkoutCard.hidden = true;
  successPanel.hidden = false;
  window.location.hash = "/order/success";
});
