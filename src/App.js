import 'bootstrap/dist/css/bootstrap.min.css';
import logo from './logo.svg';
import Container from 'react-bootstrap/Container';
import Navbar from 'react-bootstrap/Navbar';
import Nav from 'react-bootstrap/Nav';
import Button from 'react-bootstrap/Button';
import './App.css';
import React from "react";

class App extends React.Component {
  state = {
    page: 'customer',
  };

  componentDidMount() {
    this.handleHashChange();
    window.addEventListener('hashchange', this.handleHashChange);
  }

  componentWillUnmount() {
    window.removeEventListener('hashchange', this.handleHashChange);
  }

  handleHashChange = () => {
    const hash = window.location.hash.replace('#', '').toLowerCase();
    const page = ['customer', 'admin', 'organizer'].includes(hash) ? hash : 'customer';
    this.setState({ page });
  };

  renderPageContent() {
    const { page } = this.state;

    if (page === 'admin') {
      return (
        <div>
          <h1>Admin Page</h1>
          <div className="container py-3">
          <div className="row row-cols-1 row-cols-md-2 row-cols-lg-3 g-4">
            <div className="col">
              <div className="card h-100 text-start">
                <div className="card-body">
                  <form onSubmit={(e) => e.preventDefault()}>
                    <div className="mb-3">
                      <label className="form-label">Pause/Unpause TicketContract</label>
                    </div>
                    <Button type="pause" variant="danger" className="float-start">Pause</Button>
                    <Button type="unpause" variant="success" className="float-end">Unpause</Button>
                  </form>
                  <br>
                  </br>
                  <h4 className="card-title text-center">Current status: Unpaused</h4>
                </div>
              </div>
            </div>
            <div className="col">
              <div className="card h-100 text-start">
                <div className="card-body">
                  <form onSubmit={(e) => e.preventDefault()}>
                    <div className="mb-3">
                      <label className="form-label">Pause/Unpause TransferContract</label>
                    </div>
                    <Button type="pause" variant="danger" className="float-start">Pause</Button>
                    <Button type="unpause" variant="success" className="float-end">Unpause</Button>
                  </form>
                  <br>
                  </br>
                  <h4 className="card-title text-center">Current status: Unpaused</h4>
                </div>
              </div>
            </div>
            <div className="col">
              <div className="card h-100 text-start">
                <div className="card-body">
                  <form onSubmit={(e) => e.preventDefault()}>
                    <div className="mb-3">
                      <label className="form-label">Add Organizer</label>
                      <textarea className="form-control" placeholder="Enter organizer address"></textarea>
                    </div>
                    <Button type="submit" variant="primary">Add</Button>
                  </form>
                </div>
              </div>
            </div>
            <div className="col">
              <div className="card h-100 text-start">
                <div className="card-body">
                  <form onSubmit={(e) => e.preventDefault()}>
                    <div className="mb-3">
                      <label className="form-label">Add Staff</label>
                      <textarea className="form-control" placeholder="Enter staff address"></textarea>
                    </div>
                    <Button type="submit" variant="primary">Add</Button>
                  </form>
                </div>
              </div>
            </div>
            <div className="col">
              <div className="card h-100 text-start">
                <div className="card-body">
                  <form onSubmit={(e) => e.preventDefault()}>
                    <div className="mb-3">
                      <label className="form-label">Remove Organizer</label>
                      <textarea className="form-control" placeholder="Enter organizer address"></textarea>
                    </div>
                    <Button type="submit" variant="primary">Remove</Button>
                  </form>
                </div>
              </div>
            </div>
            <div className="col">
              <div className="card h-100 text-start">
                <div className="card-body">
                  <form onSubmit={(e) => e.preventDefault()}>
                    <div className="mb-3">
                      <label className="form-label">Remove Staff</label>
                      <textarea className="form-control" placeholder="Enter staff address"></textarea>
                    </div>
                    <Button type="submit" variant="primary">Remove</Button>
                  </form>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      );
    }

    if (page === 'organizer') {
      return (
        <div>
          <h1>Organizer Page</h1>
          <div className="container py-3">
          <div className="row row-cols-1 row-cols-md-2 row-cols-lg-3 g-4">
            <div className="col">
              <div className="card h-100 text-start">
                <div className="card-body">
                  <h5 className="card-title">Add Event</h5>
                  <form onSubmit={(e) => e.preventDefault()}>
                    <div className="mb-3">
                      <label className="form-label">Event Name</label>
                      <input type="text" className="form-control" placeholder="Enter event name" />
                    </div>
                    <div className="mb-3">
                      <label className="form-label">Event Date</label>
                      <input type="date" className="form-control" />
                    </div>
                    <div className="mb-3">
                      <label className="form-label">Ticket Supply</label>
                      <input type="number" className="form-control" placeholder="Enter total number of tickets" min="1" />
                    </div>
                    <div className="mb-3">
                      <label className="form-label">Primary Price</label>
                      <input type="number" className="form-control" placeholder="Enter price in USDC" min="0" step="0.01" />
                    </div>
                    <div className="mb-3">
                      <label className="form-label">Max Resale Price</label>
                      <input type="number" className="form-control" placeholder="Enter max resale price" min="0" step="0.01" />
                    </div>
                    <div className="mb-3">
                      <label className="form-label">Per Wallet Limit</label>
                      <input type="number" className="form-control" placeholder="Enter max tickets per wallet" min="1" />
                    </div>
                    <Button type="submit" variant="primary">Create Event</Button>
                  </form>
                </div>
              </div>
            </div>
            <div className="col">
              <div className="card h-100 text-start">
                <div className="card-body">
                  <h5 className="card-title">Mint Tickets</h5>
                  <form onSubmit={(e) => e.preventDefault()}>
                    <div className="mb-3">
                      <label className="form-label">Event ID</label>
                      <input type="text" className="form-control" placeholder="Enter event ID" />
                    </div>
                    <div className="mb-3">
                      <label className="form-label">Destination Address</label>
                      <input type="text" className="form-control" placeholder="Enter destination address" />
                    </div>
                    <Button type="submit" variant="primary">Mint Tickets</Button>
                  </form>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      );
    }

    return (
      <div>
        <h1>Customer Page</h1>
        <div className="container py-3">
          <div className="row row-cols-1 row-cols-md-2 row-cols-lg-3 g-4">
            <div className="col">
              <div className="card h-100 text-start">
                <div className="card-body">
                  <h5 className="card-title">Purchase USDC</h5>
                  <form onSubmit={(e) => e.preventDefault()}>
                    <div className="mb-3">
                      <label className="form-label">USDC Amount</label>
                      <input type="text" className="form-control" placeholder="Enter USDC amount" />
                    </div>
                    <Button type="submit" variant="primary">Purchase</Button>
                  </form>
                  <Button type="submit" variant="success">Show Current Balance</Button>
                </div>
              </div>
            </div>
            <div className="col">
              <div className="card h-100 text-start">
                <div className="card-body">
                  <h5 className="card-title">Buy Ticket</h5>
                  <form onSubmit={(e) => e.preventDefault()}>
                    <div className="mb-3">
                      <label className="form-label">Event ID</label>
                      <input type="number" className="form-control" placeholder="Enter event ID" />
                    </div>
                    <div className="mb-3">
                      <label className="form-label">Ticket quantity</label>
                      <input type="number" className="form-control" placeholder="1" min="1" />
                    </div>
                    <Button type="submit" variant="primary">Buy</Button>
                  </form>
                  <Button type="submit" variant="success">View Owned Tickets</Button>
                </div>
              </div>
            </div>
            <div className="col">
              <div className="card h-100 text-start">
                <div className="card-body">
                  <h5 className="card-title">Sell Ticket</h5>
                  <form onSubmit={(e) => e.preventDefault()}>
                    <div className="mb-3">
                      <label className="form-label">Ticket ID</label>
                      <input type="number" className="form-control" placeholder="Enter ticket ID" />
                    </div>
                    <div className="mb-3">
                      <label className="form-label">Ticket price</label>
                      <input type="number" className="form-control" placeholder="1" min="1" />
                    </div>
                    <Button type="submit" variant="primary">Sell</Button>
                  </form>
                  <Button type="submit" variant="danger">Cancel Listing</Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  render() {
    return (
      <div className="App">
        <Navbar className="bg-body-tertiary" data-bs-theme="dark" expand="lg">
          <Container>
            <Navbar.Brand>VeriTicket</Navbar.Brand>
            <Nav className="me-auto">
              <Nav.Link href="#customer">Customer</Nav.Link>
              <Nav.Link href="#admin">Admin</Nav.Link>
              <Nav.Link href="#organizer">Organizer</Nav.Link>
            </Nav>
          </Container>
        </Navbar>
        <header className="App-header">
          {this.renderPageContent()}
        </header>
      </div>
    );
  }
}
export default App;
