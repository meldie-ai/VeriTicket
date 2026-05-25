import logo from './logo.svg';
import Container from 'react-bootstrap/Container';
import Navbar from 'react-bootstrap/Navbar';
import './App.css';
import TicketContract from './TicketContract';
import TransferContract from './TransferContract';
import MockUSDC from './MockUSDC';
import web3 from './web3';
import React from "react";

class App extends React.Component {
state = {
  owner: '',
  account: '',
  message: '',
};
async componentDidMount() {
    const owner = await TicketContract.methods.name().call();
    this.setState({owner});
    if (window.ethereum && window.ethereum.selectedAddress) {
      this.setState({ account: window.ethereum.selectedAddress });
    }
}
connectMetaMask = async () => {
  if (!window.ethereum) {
    this.setState({ message: 'MetaMask not detected. Install MetaMask to continue.' });
    return;
  }

  try {
    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    if (accounts.length > 0) {
      this.setState({ account: accounts[0], message: 'MetaMask connected.' });
      web3.setProvider(window.ethereum);
    }
  } catch (err) {
    this.setState({ message: err.message || 'MetaMask connection failed.' });
  }
};
onSubmit = async(event) => {
  event.preventDefault();
  this.setState({ message: 'Waiting on transaction success...'});
  const accounts = await web3.eth.getAccounts();
  await TicketContract.methods.getEventDetails(this.state.value).send({
    from: accounts[0]
  });
  this.setState({ message: 'You have submitted your number!'});
};
render()
{
return (
    <div className="App">
      <header className="App-header">
        <img src={logo} className="App-logo" alt="logo" />
        <p>
        The owner name is:  {this.state.owner}
        </p>
        <button onClick={this.connectMetaMask} type="button">
          Connect MetaMask
        </button>
        {this.state.account && (
          <p>Connected account: {this.state.account}</p>
        )}
        {this.state.message && (
          <p>{this.state.message}</p>
        )}
<form onSubmit={this.onSubmit}>
<div>
<label>Type in the number you want to add:</label>
<input
value={this.state.value}
onChange={event => this.setState({ value: event.target.value })}
/>
</div>
<button>click to confirm</button>
</form>
<p>
        The stored number is:  {this.state.getEventDetails}
        </p>
        <p>
        Adding 10 to my number equals:  {this.state.getEventDetails}
        </p>
        <a
          className="App-link"
          href="https://reactjs.org"
          target="_blank"
          rel="noopener noreferrer"
        >
          Learn React
        </a>
      </header>
    </div>
  );
}
}
export default App;
